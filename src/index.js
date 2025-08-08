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
      const pathToAddons = core.getInput('path-to-addons') || 'addons';
      const serverSoftware = core.getInput('server-software') || 'paper';

      core.info(`📋 Configuration:`);
      core.info(`  Minecraft: ${minecraftVersion}`);
      core.info(`  Skript: ${skriptVersion}`);
      core.info(`  Server: ${serverSoftware}`);
      core.info(`  Scripts path: ${pathToSkripts}`);
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
    core.info(`🔽 Downloading ${serverSoftware} server v${minecraftVersion}...`);
    
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
    core.info(`🔽 Downloading Skript v${version}...`);
    
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
    core.info('📝 Copying Skript scripts...');
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
    let skriptLoadComplete = false;
    
    const options = {
      cwd: this.workDir,
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
              
              if (line.includes('[Skript]') && (
                line.includes('Successfully loaded') ||
                line.includes('Loaded') ||
                line.includes('scripts loaded')
              )) {
                skriptLoadComplete = true;
                core.info('✅ Skript loading completed');
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
      serverProcess = exec.exec('java', javaArgs, options);
      
      const maxWaitTime = 120000; // 2 хвилини
      const checkInterval = 1000; // 1 секунда
      let waitedTime = 0;
      
      while (waitedTime < maxWaitTime) {
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
      
      core.info('🛑 Stopping server for analysis...');
      await this.stopServer();
      
      try {
        await serverProcess;
      } catch (error) {
        core.info('Server stopped');
      }
      
    } catch (error) {
      core.warning(`Server process error: ${error.message}`);
    }
    core.info('🔍 Performing final analysis of server logs...');
    await this.performFinalAnalysis(serverOutput);
  }

  analyzeLogLine(line) {
    if (line.includes('[Skript]')) {
      if (line.includes("Can't understand this expression:") || 
          line.includes("is not a world") ||
          line.includes("is not a") ||
          line.includes("There's no") ||
          line.includes("Can't compare") ||
          line.includes("Can't") ||
          line.includes("error") || 
          line.includes("Error") || 
          line.includes("exception") || 
          line.includes("Exception") ||
          line.includes("Could not load") || 
          line.includes("Failed to load") ||
          line.includes("invalid") ||
          line.includes("Invalid") ||
          line.includes("unexpected") ||
          line.includes("Unexpected")) {
        
        let scriptName = 'unknown';
        
        const parenthesesMatch = line.match(/\(([^)]+\.sk)\)/);
        if (parenthesesMatch) {
          scriptName = parenthesesMatch[1];
        } else {
          const fileMatch = line.match(/([^/\\]+\.sk)/);
          if (fileMatch) {
            scriptName = fileMatch[1];
          }
        }
        
        let lineNumber = 'unknown';
        const lineMatch = line.match(/Line (\d+):/);
        if (lineMatch) {
          lineNumber = lineMatch[1];
        }
        
        const errorKey = `${scriptName}:${lineNumber}`;
        
        if (!this.processedErrors) {
          this.processedErrors = new Set();
        }
        if (!this.processedErrors.has(errorKey)) {
          this.processedErrors.add(errorKey);
          if (!this.results.failedScripts.includes(scriptName)) {
            this.results.failedScripts.push(scriptName);
          }
          let errorMessage = line.trim();
        
          if (line.includes("Can't understand this expression:")) {
            errorMessage = `Line ${lineNumber}: Can't understand expression in ${scriptName}`;
          } else if (line.includes("is not a world")) {
            errorMessage = `Line ${lineNumber}: Invalid world reference in ${scriptName}`;
          } else if (line.includes("is not a")) {
            errorMessage = `Line ${lineNumber}: Type error in ${scriptName}`;
          }
          
          this.results.errors.push({
            script: scriptName,
            line: lineNumber,
            error: errorMessage,
            rawLine: line.trim()
          });
          
          core.error(`❌ Script error: ${scriptName} (Line ${lineNumber})`);
        }
      }
      
      else if ((line.includes('Successfully loaded') || 
                line.includes('Loaded') || 
                line.includes('enabled')) && 
               line.includes('.sk')) {
        
        const scriptMatch = line.match(/([^/\\]+\.sk)/);
        if (scriptMatch) {
          const scriptName = scriptMatch[1];
          if (!this.results.failedScripts.includes(scriptName)) {
            if (!this.loadedScripts) {
              this.loadedScripts = new Set();
            }
            
            if (!this.loadedScripts.has(scriptName)) {
              this.loadedScripts.add(scriptName);
              core.info(`✅ Script loaded: ${scriptName}`);
            }
          }
        }
      }
      
      else if (line.includes('Loading') && line.includes('.sk')) {
        const scriptMatch = line.match(/([^/\\]+\.sk)/);
        if (scriptMatch) {
          const scriptName = scriptMatch[1];
          core.info(`📄 Loading script: ${scriptName}`);
        }
      }
      
      else if (line.includes('Successfully loaded') && 
               (line.includes('script') || line.includes('file'))) {
        core.info('✅ Skript finished loading scripts');
      }
    }
  }

  async stopServer() {
    const stopFile = path.join(this.workDir, 'stop.txt');
    await fs.writeFile(stopFile, 'stop\n');
    
    const serverPidFile = path.join(this.workDir, 'server.pid');
    if (await fs.pathExists(serverPidFile)) {
      try {
        const pid = await fs.readFile(serverPidFile, 'utf8');
        process.kill(parseInt(pid.trim()), 'SIGTERM');
      } catch (error) {
      }
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

  async analyzeServerOutput(output) {
    core.info('🔍 Performing backup analysis of server output...');
    
    const lines = output.split('\n');
    const scriptMessages = lines.filter(line => 
      line.includes('[Skript]') || 
      line.includes('error') ||
      line.includes('Error') ||
      line.includes('exception') ||
      line.includes('Exception')
    );

    for (const line of scriptMessages) {
      if ((line.includes('error') || line.includes('Error') || 
          line.includes('exception') || line.includes('Exception')) &&
          line.includes('[Skript]')) {
        
        const scriptMatch = line.match(/([^/\\]+\.sk)/);
        if (scriptMatch) {
          const scriptName = scriptMatch[1];
          if (!this.results.failedScripts.includes(scriptName)) {
            this.results.failedScripts.push(scriptName);
            this.results.errors.push({
              script: scriptName,
              error: line.trim()
            });
            core.warning(`🔍 Additional error found: ${scriptName}`);
          }
        }
      }
    }

    this.results.passedScripts = Math.max(0, this.results.totalScripts - this.results.failedScripts.length);
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