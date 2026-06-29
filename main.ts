import { ItemView, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";

const VIEW_TYPE_ATONAL_TODO = "atonal-todo-view";
const TODO_FILE_PATH = "Desk/Today.md";
const TASK_LINE = /^(\s*)-\s\[( |x|X)\]\s(.*)$/;

type Task = {
  line: number;
  text: string;
  completed: boolean;
};

export default class AtonalToDoPlugin extends Plugin {
  private isRedirectingTodoFile = false;

  async onload() {
    this.registerView(
      VIEW_TYPE_ATONAL_TODO,
      (leaf) => new AtonalToDoView(leaf, this)
    );

    this.addRibbonIcon("check-square", "Open AtonalToDo", () => {
      void this.openView();
    });

    this.addCommand({
      id: "open-atonal-todo",
      name: "Open AtonalToDo",
      callback: () => {
        void this.openView();
      }
    });

    this.addCommand({
      id: "open-atonal-todo-note",
      name: "Open AtonalToDo note",
      callback: () => {
        void this.openTodoFile();
      }
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file?.path !== TODO_FILE_PATH || this.isRedirectingTodoFile) {
          return;
        }

        this.isRedirectingTodoFile = true;
        window.setTimeout(() => {
          void this.openView(true).finally(() => {
            this.isRedirectingTodoFile = false;
          });
        }, 0);
      })
    );

    void this.getTodoFile();
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_ATONAL_TODO);
  }

  async openView(reuseActiveLeaf = false) {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_ATONAL_TODO);

    const leaf = this.app.workspace.getLeaf(!reuseActiveLeaf);
    if (!leaf) {
      new Notice("Could not open AtonalToDo.");
      return;
    }

    await leaf.setViewState({ type: VIEW_TYPE_ATONAL_TODO, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async openTodoFile() {
    const file = await this.getTodoFile();
    const leaf = this.app.workspace.getLeaf(true);

    if (!leaf) {
      new Notice("Could not open AtonalToDo note.");
      return;
    }

    await leaf.openFile(file);
    this.app.workspace.revealLeaf(leaf);
  }

  async getTodoFile(): Promise<TFile> {
    const path = normalizePath(TODO_FILE_PATH);
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      return existing;
    }

    if (existing) {
      throw new Error(`${path} is not a note.`);
    }

    const folder = path.split("/").slice(0, -1).join("/");
    if (folder) {
      await this.ensureFolder(folder);
    }

    return this.app.vault.create(path, "");
  }

  private async ensureFolder(path: string) {
    const parts = path.split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;

      if (this.app.vault.getAbstractFileByPath(current)) {
        continue;
      }

      await this.app.vault.createFolder(current);
    }
  }
}

class AtonalToDoView extends ItemView {
  private plugin: AtonalToDoPlugin;
  private tasks: Task[] = [];
  private file: TFile | null = null;
  private listEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AtonalToDoPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_ATONAL_TODO;
  }

  getDisplayText() {
    return "AtonalToDo";
  }

  getIcon() {
    return "check-square";
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("atonal-todo-view");

    const shell = this.contentEl.createDiv({ cls: "atonal-todo-shell" });
    const header = shell.createDiv({ cls: "atonal-todo-header" });
    header.createEl("h1", { text: "Today" });

    this.listEl = shell.createDiv({ cls: "atonal-todo-list" });

    const composer = shell.createDiv({ cls: "atonal-todo-composer" });
    this.inputEl = composer.createEl("input", {
      cls: "atonal-todo-input",
      attr: {
        type: "text",
        placeholder: "New reminder"
      }
    });

    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void this.addTask();
      }
    });

    await this.loadTasks();
  }

  async onClose() {
    this.contentEl.empty();
  }

  private async loadTasks() {
    this.file = await this.plugin.getTodoFile();
    const content = await this.plugin.app.vault.read(this.file);
    this.tasks = parseTasks(content);
    this.renderTasks();
  }

  private renderTasks() {
    if (!this.listEl) return;

    this.listEl.empty();

    if (this.tasks.length === 0) {
      this.listEl.createDiv({
        cls: "atonal-todo-empty",
        text: "No reminders yet."
      });
      return;
    }

    for (const task of this.tasks) {
      const row = this.listEl.createDiv({ cls: "atonal-todo-task" });
      row.toggleClass("is-complete", task.completed);

      const checkbox = row.createEl("button", {
        cls: "atonal-todo-checkbox",
        attr: {
          "aria-label": task.completed ? "Mark incomplete" : "Mark complete"
        }
      });
      checkbox.setAttr("aria-pressed", String(task.completed));
      checkbox.addEventListener("click", () => {
        void this.toggleTask(task.line);
      });

      row.createDiv({
        cls: "atonal-todo-task-text",
        text: task.text
      });

      const deleteButton = row.createEl("button", {
        cls: "atonal-todo-delete",
        text: "×",
        attr: {
          "aria-label": "Delete task"
        }
      });
      deleteButton.addEventListener("click", () => {
        void this.deleteTask(task.line);
      });
    }
  }

  private async addTask() {
    const text = this.inputEl?.value.trim();
    if (!text || !this.file) return;

    await this.plugin.app.vault.process(this.file, (content) => {
      const prefix = content.trim().length > 0 && !content.endsWith("\n") ? "\n" : "";
      return `${content}${prefix}- [ ] ${text}\n`;
    });

    if (this.inputEl) {
      this.inputEl.value = "";
    }

    await this.loadTasks();
  }

  private async toggleTask(line: number) {
    if (!this.file) return;

    await this.plugin.app.vault.process(this.file, (content) => {
      const lines = content.split("\n");
      const match = lines[line]?.match(TASK_LINE);

      if (!match) return content;

      const nextState = match[2].toLowerCase() === "x" ? " " : "x";
      lines[line] = `${match[1]}- [${nextState}] ${match[3]}`;
      return lines.join("\n");
    });

    await this.loadTasks();
  }

  private async deleteTask(line: number) {
    if (!this.file) return;

    await this.plugin.app.vault.process(this.file, (content) => {
      const lines = content.split("\n");
      if (!lines[line]?.match(TASK_LINE)) return content;

      lines.splice(line, 1);
      return lines.join("\n");
    });

    await this.loadTasks();
  }
}

function parseTasks(content: string): Task[] {
  return content.split("\n").flatMap((line, index) => {
    const match = line.match(TASK_LINE);
    if (!match) return [];

    return [{
      line: index,
      text: match[3],
      completed: match[2].toLowerCase() === "x"
    }];
  });
}
