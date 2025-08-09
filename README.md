# Skript Tests Action

![GitHub Actions](https://img.shields.io/badge/GitHub-Actions-blue?logo=github)
[![License](https://img.shields.io/github/license/Andromedov/skript-tests-action)](https://github.com/Andromedov/skript-tests-action/blob/main/LICENSE)
[![Minecraft](https://img.shields.io/badge/Minecraft-1.21+-green)](https://www.minecraft.net/en-us)
[![Skript](https://img.shields.io/badge/Skript-2.10+-orange)](https://github.com/SkriptLang/Skript/)
[![Stand With Ukraine](https://raw.githubusercontent.com/vshymanskyy/StandWithUkraine/main/badges/StandWithUkraine.svg)](https://stand-with-ukraine.pp.ua)

A GitHub Action for testing Skript scripts by running them in a temporary Minecraft server environment.

## Features

- ✅ Validates Skript syntax and loading
- 🔧 Supports multiple Minecraft versions and server software
- 📦 Automatic addon support
- 📊 Detailed error reporting with line numbers
- 🧹 Automatic cleanup of temporary files

## Usage

```yaml
name: Test Skript Scripts
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '21'
      - uses: Andromedov/skript-tests-action@v1.0
        with:
          minecraft-version: '1.21'
          skript-version: '2.12.1'
          path-to-skripts: './scripts'
          path-to-addons: './addons'
          server-software: 'paper'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `minecraft-version` | Minecraft version to use | Yes | `1.21` |
| `skript-version` | Skript version to use | Yes | `2.12.1` |
| `path-to-skripts` | Path to directory containing Skript files | Yes | `./scripts` |
| `path-to-addons` | Path to directory containing Skript addons | No | `./addons` |
| `server-software` | Server software to use (paper, spigot, bukkit) | No | `paper` |

## Outputs

| Output | Description |
|--------|-------------|
| `test-results` | Test results summary (JSON) |
| `failed-scripts` | List of scripts that failed to load (JSON) |
| `error-details` | Detailed error information for each failed script (JSON) |

## Example Output

The action provides detailed feedback about script validation:

```
📊 Test Results Summary:
  Total Scripts: 5
  ✅ Passed: 3
  ❌ Failed: 2

💥 Failed Scripts:
  📄 example.sk:
    ⚠️  Line 15: Can't understand expression
    ⚠️  Line 23: Invalid world reference
```

## Requirements

- Ubuntu runner (recommended)
- Java runtime (provided by GitHub Actions)
- Skript files with `.sk` extension