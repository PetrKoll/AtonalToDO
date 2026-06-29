# AtonalToDo

AtonalToDo is a simple visual todo frontend for Obsidian.

It stores tasks as normal Markdown checkboxes in Pocket and Space notes:

```md
- [ ] Buy milk
- [x] Water the plants
```

The plugin adds a clean custom view for capturing, organizing, completing, editing, and archiving tasks without hidden markers or custom syntax.

## Install for development

Clone the repository into your Obsidian vault plugins folder:

```sh
cd path/to/your/vault/.obsidian/plugins
git clone https://github.com/PetrKoll/AtonalToDO.git atonal-todo
cd atonal-todo
npm install
npm run build
```

Then open Obsidian settings, go to Community plugins, reload plugins if needed, and enable AtonalToDo.

## Usage

Open AtonalToDo from the ribbon icon or run the command:

```text
Open AtonalToDo
```

Pocket is the default capture list and lives at:

```text
Desk/Pocket.md
```

Spaces live in:

```text
Desk/Spaces/
```

Completed tasks are archived by date into:

```text
Desk/Archive/YYYY-MM-DD.md
```

Press Enter in the input to append a new unchecked task. Click a task checkbox to toggle it between `- [ ]` and `- [x]`. Use `Assign to...` from Pocket to send a task to a Space.

## Build

```sh
npm install
npm run build
```

The build creates `main.js`, which Obsidian loads together with `manifest.json` and `styles.css`.
