const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const yauzl = require('yauzl');

class SkriptTester {
  constructor() {
    this.workDir = path.join(process.cwd(), 'temp-server');
    this.serverJar = null;
    this.processedErrors = new Set();
    this.loadedScripts = new Set();
    this.pendingError = null; // Для багаточастинних повідомлень про помилки
    this.debugMode = false;
    this.results = {
      totalScripts: 0,
      passedScripts: 0,
      failedScripts: [],
      errors: []
    };
  }

  async run() {
    try {
      core.info('🚀 Starting Skript Tests Action...');
      const minecraftVersion = core.getInput('minecraft-version') || '1.21';
      const skriptVersion = core.getInput('skript-version') || '2.12.1';
      const pathToSkripts = core.getInput('path-to-skripts') || './scripts';
      const pathToAddons = core.getInput('path-to-addons') || './addons';
      const serverSoftware = core.getInput('server-software') || 'paper';
      const debug = core.getInput('debug') || 'false';

      this.debugMode = debug;
      if (debug) {
        core.info('🐛 Debug mode enabled');
      }

      core.info(`📋 Configuration:`);
      core.info(`  Minecraft: ${minecraftVersion}`);
      core.info(`  Skript: ${skriptVersion}`);
      core.info(`  Server: ${serverSoftware}`);
      core.info(`  Scripts path: ${pathToSkripts}`);
      if (debug) {
        core.info(`  Debug: enabled`);
      }

      await this.setupWorkDirectory();
      await this.downloadServer(serverSoftware, minecraftVersion);
      await this.downloadSkript(skriptVersion);
      if (pathToAddons && await fs.pathExists(pathToAddons)) {
        await this.copyAddons(pathToAddons);
      }
      await this.copyScripts(pathToSkripts);
      await this.setupServer();
      await this.runTests();
      this.outputResults();

    } catch (error) {
      core.setFailed(`❌ Action failed: ${error.message}`);
      core.error(error.stack);
    } finally {
      await this.cleanup();
    }
  }

  async setupWorkDirectory() {
    core.info('📁 Setting up work directory...');
    await fs.ensureDir(this.workDir);
    await fs.ensureDir(path.join(this.workDir, 'plugins'));
    await fs.ensureDir(path.join(this.workDir, 'plugins', 'Skript'));
    await fs.ensureDir(path.join(this.workDir, 'plugins', 'Skript', 'scripts'));
  }

  async downloadServer(serverSoftware, minecraftVersion) {
    core.info(`📽 Downloading ${serverSoftware} server v${minecraftVersion}...`);
    
    let downloadUrl;
    if (serverSoftware.toLowerCase() === 'paper') {
      const buildsData = await this.fetchJson(`https://api.papermc.io/v2/projects/paper/versions/${minecraftVersion}/builds`);
      const latestBuild = buildsData.builds[buildsData.builds.length - 1];
      downloadUrl = `https://api.papermc.io/v2/projects/paper/versions/${minecraftVersion}/builds/${latestBuild.build}/downloads/${latestBuild.downloads.application.name}`;
    } else {
      throw new Error(`Unsupported server software: ${serverSoftware}`);
    }

    const serverPath = await tc.downloadTool(downloadUrl);
    this.serverJar = path.join(this.workDir, 'server.jar');
    await fs.copy(serverPath, this.serverJar);
    
    core.info('✅ Server downloaded successfully');
  }

  async fetchJson(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (error) {
            reject(new Error(`Failed to parse JSON: ${error.message}`));
          }
        });
      }).on('error', (error) => {
        reject(new Error(`HTTP request failed: ${error.message}`));
      });
    });
  }

  async downloadSkript(version) {
    core.info(`📽 Downloading Skript v${version}...`);
    
    const downloadUrl = `https://github.com/SkriptLang/Skript/releases/download/${version}/Skript-${version}.jar`;
    const skriptPath = await tc.downloadTool(downloadUrl);
    const pluginsDir = path.join(this.workDir, 'plugins');
    await fs.copy(skriptPath, path.join(pluginsDir, 'Skript.jar'));
    
    core.info('✅ Skript downloaded successfully');
  }

  async copyAddons(addonsPath) {
    core.info('📦 Copying Skript addons...');
    const pluginsDir = path.join(this.workDir, 'plugins');
    
    const addonFiles = await fs.readdir(addonsPath);
    for (const file of addonFiles) {
      if (file.endsWith('.jar')) {
        const sourcePath = path.join(addonsPath, file);
        const targetPath = path.join(pluginsDir, file);
        await fs.copy(sourcePath, targetPath);
        core.info(`  ➕ Copied addon: ${file}`);
      }
    }
  }

  async copyScripts(scriptsPath) {
    core.info('📂 Copying Skript scripts...');
    const skriptScriptsDir = path.join(this.workDir, 'plugins', 'Skript', 'scripts');
    
    if (!await fs.pathExists(scriptsPath)) {
      throw new Error(`Scripts path does not exist: ${scriptsPath}`);
    }

    const scriptFiles = await this.getScriptFiles(scriptsPath);
    this.results.totalScripts = scriptFiles.length;

    for (const scriptFile of scriptFiles) {
      const relativePath = path.relative(scriptsPath, scriptFile);
      const targetPath = path.join(skriptScriptsDir, relativePath);
      await fs.ensureDir(path.dirname(targetPath));
      await fs.copy(scriptFile, targetPath);
      core.info(`  📄 Copied script: ${relativePath}`);
    }
  }

  async getScriptFiles(dir, files = []) {
    const items = await fs.readdir(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fs.stat(fullPath);
      
      if (stat.isDirectory()) {
        await this.getScriptFiles(fullPath, files);
      } else if (item.endsWith('.sk')) {
        files.push(fullPath);
      }
    }
    
    return files;
  }

  async setupServer() {
    core.info('⚙️ Setting up server configuration...');
    await fs.writeFile(path.join(this.workDir, 'eula.txt'), 'eula=true\n');
    
    const serverProperties = [
      'online-mode=false',
      'spawn-protection=0',
      'max-players=0',
      'gamemode=creative',
      'difficulty=peaceful',
      'motd=Skript Testing Server',
      'enable-command-block=true',
      'spawn-monsters=false',
      'spawn-animals=false',
      'spawn-npcs=false',
      'generate-structures=false',
      'view-distance=2',
      'simulation-distance=2'
    ].join('\n');
    
    await fs.writeFile(path.join(this.workDir, 'server.properties'), serverProperties);
  }

  async runTests() {
    core.info('🧪 Starting server for script validation...');
    
    const javaArgs = [
      '-Xmx1G',
      '-Xms512M',
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5',
      '-XX:G1MixedGCCountTarget=4',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:SurvivorRatio=32',
      '-XX:+PerfDisableSharedMem',
      '-XX:MaxTenuringThreshold=1',
      '-Dusing.aikars.flags=https://mcflags.emc.gs',
      '-Daikars.new.flags=true',
      '-jar',
      this.serverJar,
      '--nogui'
    ];

    let serverOutput = '';
    let serverProcess;
    let startupComplete = false;
    
    const options = {
      cwd: this.workDir,
      input: Buffer.from(''),
      listeners: {
        stdout: (data) => {
          const output = data.toString();
          serverOutput += output;
          
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              this.analyzeLogLine(line);
              if (line.includes('Done (') && line.includes('s)! For help, type "help"')) {
                startupComplete = true;
                core.info('✅ Server startup completed');
              }
              
              if (line.includes('[Skript]') || 
                  line.includes('ERROR') || 
                  line.includes('WARN') ||
                  line.includes('Done (') ||
                  line.includes('Loading') ||
                  line.includes('Enabling')) {
                core.info(line.trim());
              }
            }
          }
        },
        stderr: (data) => {
          const output = data.toString();
          serverOutput += output;
          
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              this.analyzeLogLine(line);
              core.warning(line.trim());
            }
          }
        }
      }
    };

    try {
      core.info('🚀 Starting Minecraft server...');
      const { spawn } = require('child_process');
      
      serverProcess = spawn('java', javaArgs, {
        cwd: this.workDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      serverProcess.stdout.on('data', (data) => {
        options.listeners.stdout(data);
      });
      
      serverProcess.stderr.on('data', (data) => {
        options.listeners.stderr(data);
      });
      
      const maxWaitTime = 120000; // 2 хвилини
      const checkInterval = 1000; // 1 секунда
      let waitedTime = 0;
      
      while (waitedTime < maxWaitTime && serverProcess && !serverProcess.killed) {
        await this.sleep(checkInterval);
        waitedTime += checkInterval;
        
        if (startupComplete) {
          core.info('⏱️ Waiting additional 10 seconds for script loading...');
          await this.sleep(10000);
          break;
        }
        
        if (waitedTime % 15000 === 0) {
          core.info(`⏱️ Waiting for server startup... (${waitedTime/1000}s/${maxWaitTime/1000}s)`);
        }
      }
      
      if (!startupComplete && waitedTime >= maxWaitTime) {
        core.warning('⚠️ Server startup timeout reached, analyzing partial results');
      }
      
      if (serverProcess && !serverProcess.killed) {
        core.info('🔄 Reloading scripts for detailed error analysis...');
        serverProcess.stdin.write('sk reload scripts\n');
        await this.sleep(15000);
        
        core.info('🛑 Sending stop command to server...');
        serverProcess.stdin.write('stop\n');
        await this.sleep(10000);
        if (!serverProcess.killed) {
          core.info('🔪 Force killing server process...');
          serverProcess.kill('SIGTERM');
          setTimeout(() => {
            if (!serverProcess.killed) {
              serverProcess.kill('SIGKILL');
            }
          }, 5000);
        }
      }
      
    } catch (error) {
      core.warning(`Server process error: ${error.message}`);
    }
    core.info('🔍 Performing final analysis of server logs...');
    await this.performFinalAnalysis(serverOutput);
  }

  analyzeLogLine(line) {
    if (this.debugMode && line.includes('[Skript]')) {
      core.info(`🐛 DEBUG Skript log: ${line.trim()}`);
    }

    if (!line.includes('[Skript]')) {
      return;
    }

    if (line.includes('Reloading scripts')) {
      core.info('🔄 Skript is reloading scripts...');
      return;
    }

    const errorStartMatch = line.match(/\[Skript\]\s+Line\s+(\d+):\s+\(([^)]+\.sk)\)/);
    if (errorStartMatch) {
      const lineNumber = errorStartMatch[1];
      const scriptName = errorStartMatch[2];
      
      this.pendingError = {
        script: scriptName,
        line: lineNumber,
        timestamp: Date.now()
      };
      
      if (this.debugMode) {
        core.info(`🐛 DEBUG: Found error start - Line ${lineNumber} in ${scriptName}`);
      }
      return;
    }

    if (this.pendingError && Date.now() - this.pendingError.timestamp < 3000) {
      const errorDescMatch = line.match(/\[Skript\]\s+(.+)/);
      if (errorDescMatch) {
        const errorDescription = errorDescMatch[1].trim();
        
        if (!this.isGeneralMessage(errorDescription)) {
          this.registerError(this.pendingError, errorDescription, line);
          this.pendingError = null;
          return;
        }
      }
    }

    const reloadErrorPatterns = [
      /Can't understand this expression:/,
      /There's no/,
      /Can't compare/,
      /is not a world/,
      /is not a .+/,
      /Could not load.*\.sk/,
      /Failed to load.*\.sk/,
      /invalid.*line \d+/i,
      /unexpected.*line \d+/i,
      /compile.*error/i,
      /\[ERROR\].*\.sk/,
      /Error.*\.sk/,
      /Cannot.*\.sk/,
      /Unable.*\.sk/
    ];

    for (const pattern of reloadErrorPatterns) {
      if (pattern.test(line)) {
        let scriptName = 'unknown';
        let lineNumber = 'unknown';

        const scriptMatch = line.match(/\(([^)]+\.sk)\)/) || 
                           line.match(/([^/\\\s]+\.sk)/) ||
                           line.match(/in\s+([^/\\\s]+\.sk)/);
        if (scriptMatch) {
          scriptName = scriptMatch[1];
        }

        const lineMatch = line.match(/line\s+(\d+)/i) || line.match(/Line\s+(\d+)/);
        if (lineMatch) {
          lineNumber = lineMatch[1];
        }

        this.registerError({ script: scriptName, line: lineNumber }, 
                          line.replace(/.*\[Skript\]\s*/, '').trim(), line);
        return;
      }
    }

    this.checkSuccessfulLoad(line);
  }

  isGeneralMessage(message) {
    const generalPatterns = [
      /^Loaded \d+/,
      /^Successfully loaded/,
      /^Loading/,
      /^Finished loading/,
      /^Variables/,
      /^Reloading/,
      /^Reloaded/,
      /^Disabled/,
      /^Enabled/,
      /^\s*$/
    ];

    return generalPatterns.some(pattern => pattern.test(message));
  }

  registerError(errorInfo, errorDescription, rawLine) {
    const errorKey = `${errorInfo.script}:${errorInfo.line}:${errorDescription.substring(0, 50)}`;
    
    if (this.processedErrors.has(errorKey)) {
      return; // Уже обробили цю помилку
    }

    this.processedErrors.add(errorKey);

    if (!this.results.failedScripts.includes(errorInfo.script)) {
      this.results.failedScripts.push(errorInfo.script);
    }

    const formattedError = this.formatErrorMessage(errorDescription);

    this.results.errors.push({
      script: errorInfo.script,
      line: errorInfo.line,
      error: formattedError,
      rawLine: rawLine.trim()
    });

    core.error(`❌ Script error: ${errorInfo.script} (Line ${errorInfo.line}): ${formattedError}`);
  }

  checkSuccessfulLoad(line) {
    const summaryMatch = line.match(/\[Skript\]\s+Loaded\s+(\d+)\s+scripts?/);
    if (summaryMatch) {
      const loadedCount = parseInt(summaryMatch[1]);
      this.results.totalScripts = Math.max(this.results.totalScripts, loadedCount);
      core.info(`✅ Skript loaded ${loadedCount} scripts total`);
      return;
    }

    const individualLoadPatterns = [
      /Successfully loaded.*([^/\\\s]+\.sk)/,
      /Loaded script.*([^/\\\s]+\.sk)/,
      /enabled.*([^/\\\s]+\.sk)/
    ];

    for (const pattern of individualLoadPatterns) {
      const match = line.match(pattern);
      if (match) {
        const scriptName = match[1];
        
        if (!this.results.failedScripts.includes(scriptName)) {
          if (!this.loadedScripts.has(scriptName)) {
            this.loadedScripts.add(scriptName);
            if (this.debugMode) {
              core.info(`✅ Script loaded: ${scriptName}`);
            }
          }
        }
        return;
      }
    }

    if (line.includes('Loading') && line.includes('.sk')) {
      const scriptMatch = line.match(/([^/\\\s]+\.sk)/);
      if (scriptMatch && this.debugMode) {
        core.info(`📄 Loading script: ${scriptMatch[1]}`);
      }
    }
  }

  formatErrorMessage(description) {
    if (description.includes("Can't understand this expression")) {
      return "Can't understand expression";
    } else if (description.includes("is not a world")) {
      return "Invalid world reference";
    } else if (description.includes("is not a")) {
      return "Type mismatch error";
    } else if (description.includes("There's no")) {
      return "Element not found";
    } else if (description.includes("Can't compare")) {
      return "Cannot compare values";
    } else if (description.includes("Could not load") || description.includes("Failed to load")) {
      return "Failed to load script";
    } else if (description.toLowerCase().includes("invalid")) {
      return "Invalid syntax";
    } else if (description.toLowerCase().includes("unexpected")) {
      return "Unexpected syntax";
    } else {
      return description.length > 100 ? description.substring(0, 100) + '...' : description;
    }
  }

  async performFinalAnalysis(output) {
    core.info('📊 Performing final analysis...');
    
    const lines = output.split('\n');
    
    const loadedScripts = new Set();
    const scriptLoadMessages = lines.filter(line => 
      line.includes('[Skript]') && 
      (line.includes('Loading') || line.includes('loaded')) &&
      line.includes('.sk')
    );
    
    for (const line of scriptLoadMessages) {
      const scriptMatch = line.match(/([^/\\]+\.sk)/g);
      if (scriptMatch) {
        scriptMatch.forEach(script => loadedScripts.add(script));
      }
    }
    
    if (loadedScripts.size > 0) {
      this.results.totalScripts = Math.max(this.results.totalScripts, loadedScripts.size);
    }
    
    this.results.passedScripts = this.results.totalScripts - this.results.failedScripts.length;
    
    core.info(`📈 Final count: ${this.results.totalScripts} total, ${this.results.failedScripts.length} failed`);
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  outputResults() {
    core.info('\n📊 Test Results Summary:');
    core.info(`  Total Scripts: ${this.results.totalScripts}`);
    core.info(`  ✅ Passed: ${this.results.passedScripts}`);
    core.info(`  ❌ Failed: ${this.results.failedScripts.length}`);
    
    if (this.results.failedScripts.length > 0) {
      core.info('\n💥 Failed Scripts:');
      
      const errorsByScript = {};
      this.results.errors.forEach(error => {
        if (!errorsByScript[error.script]) {
          errorsByScript[error.script] = [];
        }
        errorsByScript[error.script].push(error);
      });
      
      this.results.failedScripts.forEach(script => {
        core.error(`\n  📄 ${script}:`);
        
        if (errorsByScript[script]) {
          errorsByScript[script].forEach(error => {
            if (error.line && error.line !== 'unknown') {
              core.error(`    ⚠️  Line ${error.line}: ${error.error.replace(error.rawLine || '', '').trim()}`);
            } else {
              core.error(`    ⚠️  ${error.error}`);
            }
          });
        }
      });
      
      const totalErrors = this.results.errors.length;
      const uniqueScripts = this.results.failedScripts.length;
      
      core.info(`\n📈 Error Statistics:`);
      core.info(`  • ${uniqueScripts} script(s) with errors`);
      core.info(`  • ${totalErrors} total error(s) detected`);
      core.info(`  • ${(totalErrors / uniqueScripts).toFixed(1)} average errors per failed script`);
      
    } else {
      core.info('\n🎉 All scripts passed validation!');
    }
    
    if (this.loadedScripts) {
      const successfullyLoaded = Array.from(this.loadedScripts);
      if (successfullyLoaded.length > 0) {
        core.info(`\n✅ Successfully loaded scripts:`);
        successfullyLoaded.forEach(script => {
          if (!this.results.failedScripts.includes(script)) {
            core.info(`  • ${script}`);
          }
        });
      }
    }

    core.setOutput('test-results', JSON.stringify({
      total: this.results.totalScripts,
      passed: this.results.passedScripts,
      failed: this.results.failedScripts.length,
      errors: this.results.errors.length
    }));
    
    core.setOutput('failed-scripts', JSON.stringify(this.results.failedScripts));
    core.setOutput('error-details', JSON.stringify(this.results.errors));

    if (this.results.failedScripts.length > 0) {
      core.setFailed(`❌ ${this.results.failedScripts.length} script(s) failed validation with ${this.results.errors.length} total error(s)`);
    } else {
      core.info('🎉 All scripts passed validation!');
    }
  }

  async cleanup() {
    core.info('🧹 Cleaning up temporary files...');
    try {
      await fs.remove(this.workDir);
    } catch (error) {
      core.warning(`Failed to cleanup: ${error.message}`);
    }
  }
}

async function run() {
  const tester = new SkriptTester();
  await tester.run();
}

run();