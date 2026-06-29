import { ItemView, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";

const VIEW_TYPE_ATONAL_TODO = "atonal-todo-view";
const TODO_FILE_PATH = "Desk/Today.md";
const TASK_LINE = /^(\s*)-\s\[( |x|X)\]\s(.*)$/;

type Task = {
  line: number;
  text: string;
  completed: boolean;
};

type DragState = {
  task: Task;
  row: HTMLElement;
  pointerId: number;
  startY: number;
  dragging: boolean;
  targetLine: number | null;
  position: "before" | "after";
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
  private dragState: DragState | null = null;

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

    const activeTasks = this.tasks.filter((task) => !task.completed);
    const completedTasks = this.tasks.filter((task) => task.completed);

    this.renderTaskGroup("To do", activeTasks);
    this.renderTaskGroup("Completed", completedTasks);
  }

  private renderTaskGroup(label: string, tasks: Task[]) {
    if (!this.listEl || tasks.length === 0) return;

    const group = this.listEl.createDiv({ cls: "atonal-todo-group" });
    group.createDiv({ cls: "atonal-todo-group-label", text: label });

    for (const task of tasks) {
      const row = group.createDiv({ cls: "atonal-todo-task" });
      row.toggleClass("is-complete", task.completed);
      row.setAttr("data-task-line", String(task.line));
      row.setAttr("data-task-completed", String(task.completed));
      this.registerDragHandlers(row, task);

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

  private registerDragHandlers(row: HTMLElement, task: Task) {
    row.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;

      this.dragState = {
        task,
        row,
        pointerId: event.pointerId,
        startY: event.clientY,
        dragging: false,
        targetLine: null,
        position: "after"
      };

      row.setPointerCapture(event.pointerId);
    });

    row.addEventListener("pointermove", (event) => {
      const state = this.dragState;
      if (!state || state.pointerId !== event.pointerId) return;

      const deltaY = event.clientY - state.startY;

      if (!state.dragging && Math.abs(deltaY) < 8) {
        return;
      }

      state.dragging = true;
      state.row.addClass("is-dragging");
      state.row.style.transform = `translateY(${deltaY}px)`;

      const target = this.getDragTarget(event.clientY, state);
      this.setDropTarget(target);

      state.targetLine = target?.line ?? null;
      state.position = target?.position ?? "after";
      event.preventDefault();
    });

    row.addEventListener("pointerup", (event) => {
      void this.finishDrag(event.pointerId);
    });

    row.addEventListener("pointercancel", (event) => {
      void this.finishDrag(event.pointerId);
    });
  }

  private getDragTarget(clientY: number, state: DragState): { line: number; position: "before" | "after" } | null {
    if (!this.listEl) return null;

    const rows = Array.from(this.listEl.querySelectorAll<HTMLElement>(".atonal-todo-task"))
      .filter((row) => row !== state.row && row.dataset.taskCompleted === String(state.task.completed));

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) continue;

      const line = Number(row.dataset.taskLine);
      const position = clientY < rect.top + rect.height / 2 ? "before" : "after";
      return Number.isFinite(line) ? { line, position } : null;
    }

    return null;
  }

  private setDropTarget(target: { line: number; position: "before" | "after" } | null) {
    if (!this.listEl) return;

    for (const row of Array.from(this.listEl.querySelectorAll<HTMLElement>(".atonal-todo-task"))) {
      row.removeClass("is-drop-before", "is-drop-after");
    }

    if (!target) return;

    const row = this.listEl.querySelector<HTMLElement>(`.atonal-todo-task[data-task-line="${target.line}"]`);
    row?.addClass(target.position === "before" ? "is-drop-before" : "is-drop-after");
  }

  private async finishDrag(pointerId: number) {
    const state = this.dragState;
    if (!state || state.pointerId !== pointerId) return;

    state.row.releasePointerCapture(pointerId);
    state.row.removeClass("is-dragging");
    state.row.style.transform = "";
    this.setDropTarget(null);
    this.dragState = null;

    if (state.dragging && state.targetLine !== null && state.targetLine !== state.task.line) {
      await this.reorderTask(state.task.line, state.targetLine, state.position);
    }
  }

  private async addTask() {
    const text = this.inputEl?.value.trim();
    if (!text || !this.file) return;

    await this.plugin.app.vault.process(this.file, (content) => {
      const suffix = content.length > 0 && !content.startsWith("\n") ? "\n" : "";
      return `- [ ] ${text}${suffix}${content}`;
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

  private async reorderTask(fromLine: number, targetLine: number, position: "before" | "after") {
    if (!this.file) return;

    await this.plugin.app.vault.process(this.file, (content) => {
      const lines = content.split("\n");
      const moving = lines[fromLine];

      if (!moving?.match(TASK_LINE) || !lines[targetLine]?.match(TASK_LINE)) {
        return content;
      }

      lines.splice(fromLine, 1);

      let insertAt = targetLine;
      if (fromLine < targetLine) {
        insertAt -= 1;
      }

      if (position === "after") {
        insertAt += 1;
      }

      lines.splice(insertAt, 0, moving);
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
