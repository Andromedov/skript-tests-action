const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const yauzl = require('yauzl');

class SkriptTester {
  constructor() {
    this.workDir = path.join(process.cwd(), 'temp-server');
    this.serverJar = null;
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
      
      // Отримуємо параметри
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

      // Створюємо робочу директорію
      await this.setupWorkDirectory();

      // Завантажуємо сервер
      await this.downloadServer(serverSoftware, minecraftVersion);

      // Завантажуємо Skript
      await this.downloadSkript(skriptVersion);

      // Завантажуємо додатки, якщо вони є
      if (pathToAddons && await fs.pathExists(pathToAddons)) {
        await this.copyAddons(pathToAddons);
      }

      // Копіюємо скрипти
      await this.copyScripts(pathToSkripts);

      // Налаштовуємо сервер
      await this.setupServer();

      // Запускаємо тести
      await this.runTests();

      // Виводимо результати
      this.outputResults();

    } catch (error) {
      core.setFailed(`❌ Action failed: ${error.message}`);
      core.error(error.stack);
    } finally {
      // Очищуємо робочу директорію
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
      // Отримуємо найновішу збірку Paper
      const buildsResponse = await fetch(`https://api.papermc.io/v2/projects/paper/versions/${minecraftVersion}/builds`);
      const buildsData = await buildsResponse.json();
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
    
    // Створюємо eula.txt
    await fs.writeFile(path.join(this.workDir, 'eula.txt'), 'eula=true\n');
    
    // Налаштовуємо server.properties
    const serverProperties = [
      'online-mode=false',
      'spawn-protection=0',
      'max-players=1',
      'gamemode=creative',
      'difficulty=peaceful',
      'level-name=test-world',
      'motd=Skript Testing Server',
      'enable-command-block=true'
    ].join('\n');
    
    await fs.writeFile(path.join(this.workDir, 'server.properties'), serverProperties);
    
    // Створюємо spigot.yml для оптимізації
    const spigotConfig = `
settings:
  debug: false
  save-user-cache-on-stop-only: true
  moved-wrongly-threshold: 0.0625
  moved-too-quickly-multiplier: 10.0
  timeout-time: 60
  restart-on-crash: false
  restart-script: ./start.sh
  netty-threads: 4
  attribute:
    maxHealth:
      max: 2048.0
    movementSpeed:
      max: 2048.0
    attackDamage:
      max: 2048.0
  log-villager-deaths: true
  log-named-deaths: true
world-settings:
  default:
    verbose: false
`;
    
    await fs.writeFile(path.join(this.workDir, 'spigot.yml'), spigotConfig.trim());
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

    const options = {
      cwd: this.workDir,
      listeners: {
        stdout: (data) => {
          const output = data.toString();
          serverOutput += output;
          core.info(output.trim());
        },
        stderr: (data) => {
          const output = data.toString();
          serverOutput += output;
          core.warning(output.trim());
        }
      },
      timeout: 60000, // 60 секунд таймаут
      ignoreReturnCode: true
    };

    try {
      // Запускаємо сервер
      await exec.exec('java', javaArgs, options);
      
      // Аналізуємо результати
      await this.analyzeServerOutput(serverOutput);
      
    } catch (error) {
      if (error.message.includes('timeout')) {
        core.warning('⚠️ Server startup timeout - analyzing partial results');
        await this.analyzeServerOutput(serverOutput);
      } else {
        throw error;
      }
    }
  }

  async analyzeServerOutput(output) {
    core.info('🔍 Analyzing server output for script validation...');
    
    const lines = output.split('\n');
    const scriptMessages = lines.filter(line => 
      line.includes('[Skript]') || 
      line.includes('error') ||
      line.includes('Error') ||
      line.includes('exception') ||
      line.includes('Exception')
    );

    // Аналізуємо повідомлення про помилки
    for (const line of scriptMessages) {
      if (line.includes('error') || line.includes('Error') || 
          line.includes('exception') || line.includes('Exception')) {
        
        // Витягуємо назву файлу скрипта з повідомлення про помилку
        const scriptMatch = line.match(/([^/\\]+\.sk)/);
        if (scriptMatch) {
          const scriptName = scriptMatch[1];
          if (!this.results.failedScripts.includes(scriptName)) {
            this.results.failedScripts.push(scriptName);
            this.results.errors.push({
              script: scriptName,
              error: line.trim()
            });
          }
        } else {
          this.results.errors.push({
            script: 'unknown',
            error: line.trim()
          });
        }
      }
    }

    // Підраховуємо успішні скрипти
    this.results.passedScripts = this.results.totalScripts - this.results.failedScripts.length;
  }

  outputResults() {
    core.info('\n📊 Test Results Summary:');
    core.info(`  Total Scripts: ${this.results.totalScripts}`);
    core.info(`  ✅ Passed: ${this.results.passedScripts}`);
    core.info(`  ❌ Failed: ${this.results.failedScripts.length}`);
    
    if (this.results.failedScripts.length > 0) {
      core.info('\n💥 Failed Scripts:');
      this.results.failedScripts.forEach(script => {
        core.error(`  - ${script}`);
      });
      
      core.info('\n🔧 Error Details:');
      this.results.errors.forEach(error => {
        core.error(`  [${error.script}] ${error.error}`);
      });
    }

    // Встановлюємо outputs
    core.setOutput('test-results', JSON.stringify({
      total: this.results.totalScripts,
      passed: this.results.passedScripts,
      failed: this.results.failedScripts.length
    }));
    
    core.setOutput('failed-scripts', JSON.stringify(this.results.failedScripts));

    // Провалюємо action, якщо є помилки
    if (this.results.failedScripts.length > 0) {
      core.setFailed(`❌ ${this.results.failedScripts.length} script(s) failed to load properly`);
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

// Запускаємо action
async function run() {
  const tester = new SkriptTester();
  await tester.run();
}

run();