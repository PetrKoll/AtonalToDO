# AtonalToDo

AtonalToDo is a simple visual todo frontend for Obsidian.

It stores tasks as normal Markdown checkboxes in `Desk/Today.md`:

```md
- [ ] Buy milk
- [x] Water the plants
```

The plugin adds a clean custom view for reading, adding, completing, and deleting today's tasks without adding hidden markers or custom syntax to your notes.

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

Tasks are read from `Desk/Today.md`. Press Enter in the bottom input to append a new unchecked task. Click a task checkbox to toggle it between `- [ ]` and `- [x]`.

## Build

```sh
npm install
npm run build
```

The build creates `main.js`, which Obsidian loads together with `manifest.json` and `styles.css`.
