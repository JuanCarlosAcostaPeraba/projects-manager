let dragged: HTMLElement | null = null;
let saving = false;
const feedback = document.getElementById('board-feedback');
function announce(message: string, error = false) {
  if (feedback) {
    feedback.textContent = message;
    feedback.classList.toggle('error-text', error);
  }
}
function updateCounts() {
  document.querySelectorAll<HTMLElement>('.column').forEach((column) => {
    const count = column.querySelectorAll('.task-card').length;
    column.querySelector('[data-column-count]')!.textContent = String(count);
    (column.querySelector('[data-column-empty]') as HTMLElement).hidden =
      count > 0;
  });
  const visible = document.querySelector('[data-visible-count]');
  if (visible)
    visible.textContent = String(
      document.querySelectorAll('.task-card').length,
    );
}
async function moveTask(card: HTMLElement, status: string) {
  if (saving) return;
  const oldColumn = card.closest<HTMLElement>('.column')!;
  const select = card.querySelector<HTMLSelectElement>('select[name=status]')!;
  const previous = oldColumn.dataset.status!;
  if (previous === status) return;
  saving = true;
  card.classList.add('saving');
  document
    .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
      '.status-form button,.status-form select',
    )
    .forEach((control) => (control.disabled = true));
  announce('Guardando el cambio de estado…');
  try {
    const response = await fetch('/api/command', {
      method: 'POST',
      headers: { accept: 'application/json' },
      body: new URLSearchParams({
        action: 'task.status',
        task_id: card.dataset.taskId!,
        version: card.dataset.version!,
        status,
      }),
    });
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo guardar.');
    const target = document.querySelector<HTMLElement>(
      `.column[data-status="${status}"]`,
    )!;
    target
      .querySelector('.column-cards')!
      .insertBefore(card, target.querySelector('[data-column-empty]'));
    card.dataset.version = String(Number(card.dataset.version) + 1);
    card.querySelector<HTMLInputElement>('input[name=version]')!.value =
      card.dataset.version;
    card.querySelector<HTMLElement>(
      '[data-delete-action]',
    )!.dataset.entityVersion = card.dataset.version;
    card.classList.toggle('completed', status === 'done');
    select.value = status;
    const due = card.querySelector<HTMLElement>('.due-date')!;
    due.classList.toggle(
      'overdue',
      Boolean(
        card.dataset.dueDate &&
        card.dataset.dueDate <
          document.querySelector<HTMLElement>('.kanban-board')!.dataset
            .today! &&
        status !== 'done',
      ),
    );
    updateCounts();
    const completed = document.querySelector('[data-completed-count]');
    // Keep the project total accurate even when cards are filtered.
    if (completed)
      completed.textContent = String(
        Number(completed.textContent) +
          (status === 'done' ? 1 : 0) -
          (previous === 'done' ? 1 : 0),
      );
    const filterStatus = new URL(window.location.href).searchParams.get(
      'status',
    );
    if (filterStatus && filterStatus !== status) {
      card.remove();
      updateCounts();
    }
    announce('Estado guardado.');
  } catch (error) {
    select.value = previous;
    announce(
      error instanceof Error ? error.message : 'No se pudo guardar.',
      true,
    );
  } finally {
    saving = false;
    card.classList.remove('saving');
    document
      .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
        '.status-form button,.status-form select',
      )
      .forEach((control) => (control.disabled = false));
  }
}
document
  .querySelectorAll<HTMLElement>('.task-card[draggable="true"]')
  .forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      if (
        saving ||
        (event.target as Element).closest('button,select,input,details')
      ) {
        event.preventDefault();
        return;
      }
      dragged = card;
      event.dataTransfer?.setData('text/plain', card.dataset.taskId!);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      dragged = null;
      document
        .querySelectorAll('.drop-target')
        .forEach((column) => column.classList.remove('drop-target'));
    });
    card
      .querySelector<HTMLFormElement>('.status-form')!
      .addEventListener('submit', (event) => {
        event.preventDefault();
        void moveTask(
          card,
          card.querySelector<HTMLSelectElement>('select[name=status]')!.value,
        );
      });
  });
document.querySelectorAll<HTMLElement>('.column').forEach((column) => {
  column.addEventListener('dragover', (event) => {
    if (dragged && !saving) {
      event.preventDefault();
      column.classList.add('drop-target');
    }
  });
  column.addEventListener('dragleave', (event) => {
    if (!column.contains(event.relatedTarget as Node))
      column.classList.remove('drop-target');
  });
  column.addEventListener('drop', (event) => {
    event.preventDefault();
    column.classList.remove('drop-target');
    if (dragged && !saving) void moveTask(dragged, column.dataset.status!);
  });
});
