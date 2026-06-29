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
  currentY: number;
  holdTimer: number | null;
  ready: boolean;
  dragging: boolean;
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
  private reloadTimer: number | null = null;
  private isWriting = false;
  private suppressNextTextClick = false;

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

    this.registerEvent(
      this.plugin.app.vault.on("modify", (file) => {
        if (file.path !== TODO_FILE_PATH || this.isWriting) return;

        if (this.reloadTimer !== null) {
          window.clearTimeout(this.reloadTimer);
        }

        this.reloadTimer = window.setTimeout(() => {
          this.reloadTimer = null;
          void this.loadTasks();
        }, 250);
      })
    );

    await this.loadTasks();
  }

  async onClose() {
    if (this.reloadTimer !== null) {
      window.clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }

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
      window.requestAnimationFrame(() => row.addClass("is-visible"));

      const checkbox = row.createEl("button", {
        cls: "atonal-todo-checkbox",
        attr: {
          "aria-label": task.completed ? "Mark incomplete" : "Mark complete"
        }
      });
      checkbox.setAttr("aria-pressed", String(task.completed));
      checkbox.addEventListener("click", () => {
        void this.toggleTask(task, row);
      });

      const textEl = row.createDiv({
        cls: "atonal-todo-task-text",
        text: task.text
      });
      textEl.addEventListener("click", () => {
        this.editTask(task, textEl);
      });

      const deleteButton = row.createEl("button", {
        cls: "atonal-todo-delete",
        text: "×",
        attr: {
          "aria-label": "Delete task"
        }
      });
      deleteButton.addEventListener("click", () => {
        void this.deleteTask(task, row);
      });
    }
  }

  private registerDragHandlers(row: HTMLElement, task: Task) {
    row.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button, input")) return;

      const isTouch = event.pointerType === "touch";

      this.dragState = {
        task,
        row,
        pointerId: event.pointerId,
        startY: event.clientY,
        currentY: event.clientY,
        holdTimer: null,
        ready: !isTouch,
        dragging: false
      };

      if (isTouch) {
        this.dragState.holdTimer = window.setTimeout(() => {
          if (!this.dragState || this.dragState.pointerId !== event.pointerId) return;

          this.dragState.ready = true;
          row.addClass("is-lifted");
          row.setPointerCapture(event.pointerId);
        }, 180);
      } else {
        row.setPointerCapture(event.pointerId);
      }
    });

    row.addEventListener("pointermove", (event) => {
      const state = this.dragState;
      if (!state || state.pointerId !== event.pointerId) return;

      const deltaY = event.clientY - state.startY;
      state.currentY = event.clientY;

      if (!state.ready) {
        if (Math.abs(deltaY) > 12) {
          this.cancelDrag();
        }
        return;
      }

      if (!state.dragging && Math.abs(deltaY) < 8) {
        return;
      }

      state.dragging = true;
      state.row.addClass("is-dragging");
      state.row.style.transform = `translateY(${deltaY}px)`;

      this.setDropTarget(this.getDropPreview(event.clientY, state));
      event.preventDefault();
    });

    row.addEventListener("pointerup", (event) => {
      void this.finishDrag(event.pointerId, event.clientY);
    });

    row.addEventListener("pointercancel", (event) => {
      void this.finishDrag(event.pointerId, this.dragState?.currentY ?? event.clientY);
    });
  }

  private cancelDrag() {
    const state = this.dragState;
    if (!state) return;

    if (state.holdTimer !== null) {
      window.clearTimeout(state.holdTimer);
    }

    state.row.removeClass("is-lifted", "is-dragging");
    state.row.style.transform = "";
    this.setDropTarget(null);
    this.dragState = null;
  }

  private getDropPreview(clientY: number, state: DragState): { line: number; position: "before" | "after" } | null {
    if (!this.listEl) return null;

    const rows = Array.from(this.listEl.querySelectorAll<HTMLElement>(".atonal-todo-task"))
      .filter((row) => row !== state.row && row.dataset.taskCompleted === String(state.task.completed));

    if (rows.length === 0) return null;

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const line = Number(row.dataset.taskLine);

      if (!Number.isFinite(line)) continue;

      if (clientY < rect.top + rect.height / 2) {
        return { line, position: "before" };
      }
    }

    const lastLine = Number(rows[rows.length - 1].dataset.taskLine);
    return Number.isFinite(lastLine) ? { line: lastLine, position: "after" } : null;
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

  private async finishDrag(pointerId: number, clientY: number) {
    const state = this.dragState;
    if (!state || state.pointerId !== pointerId) return;

    if (state.holdTimer !== null) {
      window.clearTimeout(state.holdTimer);
    }

    if (state.row.hasPointerCapture(pointerId)) {
      state.row.releasePointerCapture(pointerId);
    }

    state.row.removeClass("is-lifted", "is-dragging");
    state.row.style.transform = "";
    this.setDropTarget(null);
    this.dragState = null;

    if (state.dragging) {
      this.suppressNextTextClick = true;
      window.setTimeout(() => {
        this.suppressNextTextClick = false;
      }, 0);

      const targetIndex = this.getDropIndex(clientY, state);
      await this.reorderTask(state.task, targetIndex);
    }
  }

  private getDropIndex(clientY: number, state: DragState): number {
    if (!this.listEl) return 0;

    const rows = Array.from(this.listEl.querySelectorAll<HTMLElement>(".atonal-todo-task"))
      .filter((row) => row !== state.row && row.dataset.taskCompleted === String(state.task.completed));

    const index = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });

    return index === -1 ? rows.length : index;
  }

  private async addTask() {
    const text = this.inputEl?.value.trim();
    if (!text || !this.file) return;

    await this.writeTodoFile((content) => {
      const suffix = content.length > 0 && !content.startsWith("\n") ? "\n" : "";
      return `- [ ] ${text}${suffix}${content}`;
    });

    if (this.inputEl) {
      this.inputEl.value = "";
    }

    await this.loadTasks();
  }

  private async toggleTask(task: Task, row: HTMLElement) {
    if (!this.file) return;

    row.addClass(task.completed ? "is-restoring" : "is-finishing");
    await delay(140);

    await this.writeTodoFile((content) => {
      const lines = content.split("\n");
      const line = findTaskLine(content, task);

      if (line === null) return content;

      const match = lines[line]?.match(TASK_LINE);
      if (!match) return content;

      const nextState = match[2].toLowerCase() === "x" ? " " : "x";
      lines[line] = `${match[1]}- [${nextState}] ${match[3]}`;
      return lines.join("\n");
    });

    await this.loadTasks();
  }

  private async deleteTask(task: Task, row: HTMLElement) {
    if (!this.file) return;

    row.addClass("is-removing");
    await delay(140);

    await this.writeTodoFile((content) => {
      const lines = content.split("\n");
      const line = findTaskLine(content, task);

      if (line === null) return content;
      if (!lines[line]?.match(TASK_LINE)) return content;

      lines.splice(line, 1);
      return lines.join("\n");
    });

    await this.loadTasks();
  }

  private editTask(task: Task, textEl: HTMLElement) {
    if (this.suppressNextTextClick) return;
    if (textEl.querySelector("input")) return;

    const editor = textEl.createEl("input", {
      cls: "atonal-todo-edit",
      attr: {
        type: "text",
        "aria-label": "Edit task"
      }
    });

    editor.value = task.text;
    textEl.empty();
    textEl.appendChild(editor);
    editor.focus();
    editor.select();

    const save = () => {
      const nextText = editor.value.trim();
      if (!nextText || nextText === task.text) {
        void this.loadTasks();
        return;
      }

      void this.renameTask(task, nextText);
    };

    editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        editor.blur();
      }

      if (event.key === "Escape") {
        void this.loadTasks();
      }
    });

    editor.addEventListener("blur", save, { once: true });
  }

  private async renameTask(task: Task, nextText: string) {
    if (!this.file) return;

    await this.writeTodoFile((content) => {
      const lines = content.split("\n");
      const line = findTaskLine(content, task);

      if (line === null) return content;

      const match = lines[line]?.match(TASK_LINE);
      if (!match) return content;

      lines[line] = `${match[1]}- [${match[2]}] ${nextText}`;
      return lines.join("\n");
    });

    await this.loadTasks();
  }

  private async reorderTask(task: Task, targetIndex: number) {
    if (!this.file) return;

    await this.writeTodoFile((content) => {
      const lines = content.split("\n");
      const originalLines = lines.slice();
      const tasks = parseTasks(content);
      const group = tasks.filter((currentTask) => currentTask.completed === task.completed);
      const currentLine = findTaskLine(content, task);
      const movingIndex = currentLine === null ? -1 : group.findIndex((currentTask) => currentTask.line === currentLine);

      if (movingIndex === -1) {
        return content;
      }

      const nextGroup = group.slice();
      const [moving] = nextGroup.splice(movingIndex, 1);
      const boundedIndex = Math.max(0, Math.min(targetIndex, nextGroup.length));
      nextGroup.splice(boundedIndex, 0, moving);

      if (nextGroup.every((task, index) => task.line === group[index].line)) {
        return content;
      }

      for (let index = 0; index < group.length; index += 1) {
        lines[group[index].line] = originalLines[nextGroup[index].line];
      }

      return lines.join("\n");
    });

    await this.loadTasks();
  }

  private async writeTodoFile(update: (content: string) => string) {
    if (!this.file) return;

    this.isWriting = true;

    try {
      await this.plugin.app.vault.process(this.file, update);
    } finally {
      window.setTimeout(() => {
        this.isWriting = false;
      }, 300);
    }
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

function findTaskLine(content: string, task: Task): number | null {
  const lines = content.split("\n");
  const currentLine = lines[task.line];

  if (lineMatchesTask(currentLine, task)) {
    return task.line;
  }

  const fallbackLine = lines.findIndex((line) => lineMatchesTask(line, task));
  return fallbackLine === -1 ? null : fallbackLine;
}

function lineMatchesTask(line: string | undefined, task: Task) {
  const match = line?.match(TASK_LINE);

  if (!match) return false;

  return match[3] === task.text && (match[2].toLowerCase() === "x") === task.completed;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
