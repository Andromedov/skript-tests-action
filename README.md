# Skript Tests Action

GitHub Action для автоматичного тестування скриптів Skript в середовищі Minecraft сервера.

## Використання

### Базове використання

```yaml
- name: Test Skript Scripts
  uses: your-username/skript-tests-action@v1.0
  with:
    minecraft-version: '1.21'
    skript-version: '2.12.1'
    path-to-skripts: './scripts'
    path-to-addons: './addons'
    server-software: 'paper'
```

### Матричне тестування

```yaml
strategy:
  matrix:
    minecraft-version: ['1.20.1', '1.21']
    skript-version: ['2.11.0', '2.12.1']

steps:
  - uses: actions/checkout@v4
  
  - name: Test Scripts
    uses: your-username/skript-tests-action@v1.0
    with:
      minecraft-version: ${{ matrix.minecraft-version }}
      skript-version: ${{ matrix.skript-version }}
      path-to-skripts: './scripts'
      server-software: 'paper'
```

## Параметри

| Параметр | Опис | Обов'язковий | За замовчуванням |
|----------|------|--------------|------------------|
| `minecraft-version` | Версія Minecraft | Так | `1.21` |
| `skript-version` | Версія Skript | Так | `2.12.1` |
| `path-to-skripts` | Шлях до директорії зі скриптами | Так | `./scripts` |
| `path-to-addons` | Шлях до директорії з додатками | Ні | `addons` |
| `server-software` | Тип сервера (paper, spigot, bukkit) | Ні | `paper` |

## Outputs

| Output | Опис |
|--------|------|
| `test-results` | JSON з результатами тестів |
| `failed-scripts` | Список скриптів, які не пройшли тест |

### Приклад використання outputs

```yaml
- name: Test Scripts
  id: test-step
  uses: your-username/skript-tests-action@v1.0
  with:
    minecraft-version: '1.21'
    skript-version: '2.12.1'
    path-to-skripts: './scripts'

- name: Process Results
  if: always()
  run: |
    echo "Test results: ${{ steps.test-step.outputs.test-results }}"
    echo "Failed scripts: ${{ steps.test-step.outputs.failed-scripts }}"
```

## Структура проекту

```
your-repo/
├── scripts/                 # Ваші Skript файли
│   ├── main.sk
│   ├── events/
│   │   └── player-events.sk
│   └── commands/
│       └── custom-commands.sk
├── addons/                  # JAR файли додатків (опціонально)
│   ├── skript-addon1.jar
│   └── skript-addon2.jar
├── .github/
│   └── workflows/
│       └── skript-tests.yml
└── README.md
```

## Як це працює

1. **Налаштування середовища**: Action створює тимчасову директорію та налаштовує Java
2. **Завантаження сервера**: Завантажується відповідна версія Paper/Spigot сервера
3. **Встановлення Skript**: Завантажується та встановлюється Skript плагін
4. **Копіювання файлів**: Ваші скрипти та додатки копіюються в сервер
5. **Запуск тестів**: Сервер запускається та намагається завантажити всі скрипти
6. **Аналіз результатів**: Логи сервера аналізуються на предмет помилок
7. **Звітність**: Виводяться результати та встановлюються outputs

## Типові помилки та їх вирішення

### "No .sk files found"
- Перевірте правильність шляху в `path-to-skripts`
- Переконайтеся, що ваші файли мають розширення `.sk`

### "Server startup timeout"
- Можливо, сервер завантажується занадто довго
- Перевірте, чи немає конфліктуючих додатків

### "Script parsing error"
- Перевірте синтаксис ваших скриптів
- Переконайтеся в сумісності з версією Skript

## Підтримувані версії

### Minecraft
- 1.20.x
- 1.21.x
- (інші версії можуть працювати, але не тестувалися)

### Skript
- 2.11.x
- 2.12.x
- (перевірте сумісність на GitHub Skript)

### Server Software
- Paper (рекомендовано)
- Spigot (планується)
- Bukkit (планується)

## Оптимізація

### Кешування
Для прискорення збірок використовуйте кешування:

```yaml
- name: Cache server files
  uses: actions/cache@v4
  with:
    path: |
      ~/.cache/skript-action
    key: ${{ runner.os }}-server-${{ matrix.minecraft-version }}-${{ matrix.skript-version }}
```

### Паралельне тестування
Використовуйте матричні збірки для тестування з різними версіями одночасно:

```yaml
strategy:
  matrix:
    minecraft-version: ['1.20.1', '1.21']
  fail-fast: false  # Продовжувати навіть якщо одна версія провалилася
```

## Розробка

### Локальне тестування

```bash
# Клон