import { ItemView, Menu, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";

const VIEW_TYPE_ATONAL_TODO = "atonal-todo-view";
const POCKET_FILE_PATH = "Desk/Pocket.md";
const SPACES_FOLDER_PATH = "Desk/Spaces";
const ARCHIVE_FOLDER_PATH = "Desk/Archive";
const TASK_LINE = /^(\s*)-\s\[( |x|X)\]\s(.*)$/;
const DEFAULT_SPACES = ["Fixed Delivery", "VRKO", "Workshop", "Shopping", "Ideas"];

type Task = {
  line: number;
  text: string;
  completed: boolean;
};

type SpaceFile = {
  name: string;
  path: string;
};

type AtonalToDoSettings = {
  lastArchiveDate: string;
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

const DEFAULT_SETTINGS: AtonalToDoSettings = {
  lastArchiveDate: ""
};

export default class AtonalToDoPlugin extends Plugin {
  settings: AtonalToDoSettings = DEFAULT_SETTINGS;
  activePath = POCKET_FILE_PATH;
  private isRedirectingManagedFile = false;
  private allowRawManagedOpenOnce = false;

  async onload() {
    await this.loadSettings();
    await this.ensureWorkspaceFiles();
    await this.archiveCompletedIfNeeded();

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
      id: "open-atonal-todo-pocket-note",
      name: "Open AtonalToDo Pocket note",
      callback: () => {
        void this.openPocketNote();
      }
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (this.allowRawManagedOpenOnce) {
          this.allowRawManagedOpenOnce = false;
          return;
        }

        if (!file || !this.isManagedTaskPath(file.path) || this.isRedirectingManagedFile) {
          return;
        }

        this.isRedirectingManagedFile = true;
        window.setTimeout(() => {
          void this.openView(file.path, true).finally(() => {
            this.isRedirectingManagedFile = false;
          });
        }, 0);
      })
    );
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_ATONAL_TODO);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async openView(path = POCKET_FILE_PATH, reuseActiveLeaf = false) {
    await this.ensureWorkspaceFiles();
    this.activePath = normalizePath(path);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_ATONAL_TODO);

    const leaf = this.app.workspace.getLeaf(!reuseActiveLeaf);
    if (!leaf) {
      new Notice("Could not open AtonalToDo.");
      return;
    }

    await leaf.setViewState({ type: VIEW_TYPE_ATONAL_TODO, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async openPocketNote() {
    const file = await this.getOrCreateFile(POCKET_FILE_PATH);
    const leaf = this.app.workspace.getLeaf(true);

    if (!leaf) {
      new Notice("Could not open Pocket note.");
      return;
    }

    this.allowRawManagedOpenOnce = true;
    await leaf.openFile(file);
    this.app.workspace.revealLeaf(leaf);
  }

  async ensureWorkspaceFiles() {
    await this.getOrCreateFile(POCKET_FILE_PATH);
    await this.ensureFolder(SPACES_FOLDER_PATH);
    await this.ensureFolder(ARCHIVE_FOLDER_PATH);

    const spaces = await this.listSpaces(false);
    if (spaces.length > 0) return;

    for (const name of DEFAULT_SPACES) {
      await this.getOrCreateFile(`${SPACES_FOLDER_PATH}/${name}.md`);
    }
  }

  async getOrCreateFile(path: string): Promise<TFile> {
    const normalizedPath = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (existing instanceof TFile) {
      return existing;
    }

    if (existing) {
      throw new Error(`${normalizedPath} is not a note.`);
    }

    const folder = normalizedPath.split("/").slice(0, -1).join("/");
    if (folder) {
      await this.ensureFolder(folder);
    }

    return this.app.vault.create(normalizedPath, "");
  }

  async listSpaces(ensureDefaults = true): Promise<SpaceFile[]> {
    if (ensureDefaults) {
      await this.ensureWorkspaceFiles();
    }

    return this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${SPACES_FOLDER_PATH}/`))
      .sort((a, b) => a.basename.localeCompare(b.basename))
      .map((file) => ({
        name: file.basename,
        path: file.path
      }));
  }

  isManagedTaskPath(path: string) {
    return path === POCKET_FILE_PATH || path.startsWith(`${SPACES_FOLDER_PATH}/`);
  }

  getDisplayName(path: string) {
    if (path === POCKET_FILE_PATH) return "Pocket";

    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return file.basename;

    return path.split("/").pop()?.replace(/\.md$/, "") ?? "Space";
  }

  async assignTaskToSpace(task: Task, space: SpaceFile) {
    const pocketFile = await this.getOrCreateFile(POCKET_FILE_PATH);
    const spaceFile = await this.getOrCreateFile(space.path);

    await this.app.vault.process(pocketFile, (content) => {
      const lines = content.split("\n");
      const line = findTaskLine(content, task);

      if (line === null) return content;

      lines.splice(line, 1);
      return lines.join("\n");
    });

    await this.appendTaskLines(spaceFile, [`- [ ] ${task.text}`]);
  }

  async archiveCompletedNow() {
    const today = formatDate(new Date());
    await this.archiveCompletedTasks(today);
    this.settings.lastArchiveDate = today;
    await this.saveSettings();
  }

  async archiveCompletedIfNeeded() {
    const today = formatDate(new Date());
    if (this.settings.lastArchiveDate === today) return;

    await this.archiveCompletedTasks(today);
    this.settings.lastArchiveDate = today;
    await this.saveSettings();
  }

  private async archiveCompletedTasks(archiveDate: string) {
    const sources = [
      { name: "Pocket", file: await this.getOrCreateFile(POCKET_FILE_PATH) },
      ...(await this.listSpaces()).map((space) => ({
        name: space.name,
        file: this.app.vault.getAbstractFileByPath(space.path)
      }))
    ];
    const sections: { name: string; lines: string[] }[] = [];

    for (const source of sources) {
      if (!(source.file instanceof TFile)) continue;

      const movedLines: string[] = [];
      await this.app.vault.process(source.file, (content) => {
        const nextLines: string[] = [];

        for (const line of content.split("\n")) {
          const match = line.match(TASK_LINE);

          if (match && match[2].toLowerCase() === "x") {
            movedLines.push(`- [x] ${match[3]}`);
            continue;
          }

          nextLines.push(line);
        }

        return trimTrailingBlankLines(nextLines).join("\n");
      });

      if (movedLines.length > 0) {
        sections.push({ name: source.name, lines: movedLines });
      }
    }

    if (sections.length === 0) return;

    const archiveFile = await this.getOrCreateFile(`${ARCHIVE_FOLDER_PATH}/${archiveDate}.md`);
    await this.appendArchiveSections(archiveFile, sections);
  }

  private async appendArchiveSections(file: TFile, sections: { name: string; lines: string[] }[]) {
    await this.app.vault.process(file, (content) => {
      const existing = content.trimEnd();
      const next = sections
        .map((section) => `## ${section.name}\n${section.lines.join("\n")}`)
        .join("\n\n");

      return existing.length > 0 ? `${existing}\n\n${next}\n` : `${next}\n`;
    });
  }

  private async appendTaskLines(file: TFile, lines: string[]) {
    await this.app.vault.process(file, (content) => {
      const existing = content.trimEnd();
      const next = lines.join("\n");

      return existing.length > 0 ? `${existing}\n${next}\n` : `${next}\n`;
    });
  }

  private async ensureFolder(path: string) {
    const parts = normalizePath(path).split("/").filter(Boolean);
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
  private currentPath = POCKET_FILE_PATH;
  private titleEl: HTMLElement | null = null;
  private spacesEl: HTMLElement | null = null;
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
    this.currentPath = this.plugin.activePath;
    this.contentEl.empty();
    this.contentEl.addClass("atonal-todo-view");

    const shell = this.contentEl.createDiv({ cls: "atonal-todo-shell" });
    this.spacesEl = shell.createDiv({ cls: "atonal-todo-spaces" });

    const header = shell.createDiv({ cls: "atonal-todo-header" });
    this.titleEl = header.createEl("h1", { text: this.plugin.getDisplayName(this.currentPath) });
    const archiveButton = header.createEl("button", {
      cls: "atonal-todo-end-day",
      text: "Archive Done",
      attr: {
        type: "button"
      }
    });
    archiveButton.addEventListener("click", () => {
      void this.archiveDone();
    });

    this.listEl = shell.createDiv({ cls: "atonal-todo-list" });

    const composer = shell.createDiv({ cls: "atonal-todo-composer" });
    this.inputEl = composer.createEl("input", {
      cls: "atonal-todo-input",
      attr: {
        type: "text",
        placeholder: "Capture a task"
      }
    });

    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void this.addTask();
      }
    });

    this.registerEvent(
      this.plugin.app.vault.on("modify", (file) => {
        if (file.path !== this.currentPath || this.isWriting) return;

        if (this.reloadTimer !== null) {
          window.clearTimeout(this.reloadTimer);
        }

        this.reloadTimer = window.setTimeout(() => {
          this.reloadTimer = null;
          void this.loadTasks();
        }, 250);
      })
    );

    await this.plugin.archiveCompletedIfNeeded();
    await this.renderSpaces();
    await this.loadTasks();
  }

  async onClose() {
    if (this.reloadTimer !== null) {
      window.clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }

    this.contentEl.empty();
  }

  private async setCurrentPath(path: string) {
    this.currentPath = normalizePath(path);
    this.plugin.activePath = this.currentPath;
    await this.renderSpaces();
    await this.loadTasks();
  }

  private async renderSpaces() {
    if (!this.spacesEl) return;

    this.spacesEl.empty();
    this.renderSpaceButton("Pocket", POCKET_FILE_PATH);

    for (const space of await this.plugin.listSpaces()) {
      this.renderSpaceButton(space.name, space.path);
    }
  }

  private renderSpaceButton(label: string, path: string) {
    if (!this.spacesEl) return;

    const button = this.spacesEl.createEl("button", {
      cls: "atonal-todo-space",
      text: label,
      attr: {
        type: "button"
      }
    });
    button.toggleClass("is-active", normalizePath(path) === this.currentPath);
    button.addEventListener("click", () => {
      void this.setCurrentPath(path);
    });
  }

  private async loadTasks() {
    this.file = await this.plugin.getOrCreateFile(this.currentPath);
    const content = await this.plugin.app.vault.read(this.file);
    this.tasks = parseTasks(content);
    this.titleEl?.setText(this.plugin.getDisplayName(this.currentPath));
    this.renderTasks();
  }

  private renderTasks() {
    if (!this.listEl) return;

    this.listEl.empty();

    if (this.tasks.length === 0) {
      this.listEl.createDiv({
        cls: "atonal-todo-empty",
        text: "No tasks here yet."
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
      row.toggleClass("has-assign", this.currentPath === POCKET_FILE_PATH);
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
        void this.toggleTask(task, row);
      });

      const textEl = row.createDiv({
        cls: "atonal-todo-task-text",
        text: task.text
      });
      textEl.addEventListener("click", () => {
        this.editTask(task, textEl);
      });

      if (this.currentPath === POCKET_FILE_PATH) {
        const assignButton = row.createEl("button", {
          cls: "atonal-todo-assign",
          text: "Assign to...",
          attr: {
            type: "button",
            "aria-label": "Assign to Space"
          }
        });
        assignButton.addEventListener("click", (event) => {
          void this.showAssignMenu(task, event);
        });
      }

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

  private async showAssignMenu(task: Task, event: MouseEvent) {
    const spaces = await this.plugin.listSpaces();
    const menu = new Menu();

    for (const space of spaces) {
      menu.addItem((item) => {
        item
          .setTitle(space.name)
          .onClick(() => {
            void this.assignTask(task, space);
          });
      });
    }

    menu.showAtMouseEvent(event);
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
      const state = this.dragState;
      const textEl = (event.target as HTMLElement).closest<HTMLElement>(".atonal-todo-task-text");
      const shouldEdit = !!state && state.pointerId === event.pointerId && !state.dragging && !!textEl;

      void this.finishDrag(event.pointerId, event.clientY);

      if (shouldEdit) {
        this.editTask(task, textEl);
      }
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

    await this.writeCurrentFile((content) => {
      const suffix = content.length > 0 && !content.startsWith("\n") ? "\n" : "";
      return `- [ ] ${text}${suffix}${content}`;
    });

    if (this.inputEl) {
      this.inputEl.value = "";
    }

    await this.loadTasks();
  }

  private async archiveDone() {
    await this.plugin.archiveCompletedNow();
    new Notice("Completed tasks archived.");
    await this.loadTasks();
  }

  private async assignTask(task: Task, space: SpaceFile) {
    if (this.currentPath !== POCKET_FILE_PATH) return;

    await this.plugin.assignTaskToSpace(task, space);
    await this.loadTasks();
  }

  private async toggleTask(task: Task, row: HTMLElement) {
    if (!this.file) return;

    row.addClass(task.completed ? "is-restoring" : "is-finishing");
    await delay(360);

    await this.writeCurrentFile((content) => {
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
    await delay(190);

    await this.writeCurrentFile((content) => {
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

    textEl.empty();

    const editor = textEl.createEl("input", {
      cls: "atonal-todo-edit",
      attr: {
        type: "text",
        "aria-label": "Edit task"
      }
    });

    editor.value = task.text;
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

    await this.writeCurrentFile((content) => {
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

    await this.writeCurrentFile((content) => {
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

      if (nextGroup.every((nextTask, index) => nextTask.line === group[index].line)) {
        return content;
      }

      for (let index = 0; index < group.length; index += 1) {
        lines[group[index].line] = originalLines[nextGroup[index].line];
      }

      return lines.join("\n");
    });

    await this.loadTasks();
  }

  private async writeCurrentFile(update: (content: string) => string) {
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

function trimTrailingBlankLines(lines: string[]) {
  const nextLines = lines.slice();

  while (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() === "") {
    nextLines.pop();
  }

  return nextLines;
}

function formatDate(date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
