const dialog = document.getElementById(
  'delete-confirmation',
) as HTMLDialogElement | null;
document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    '[data-delete-action]',
  );
  if (!button || !dialog) return;
  const action = dialog.querySelector<HTMLInputElement>(
    '[data-delete-input-action]',
  )!;
  const id = dialog.querySelector<HTMLInputElement>('[data-delete-input-id]')!;
  const version = dialog.querySelector<HTMLInputElement>(
    '[data-delete-input-version]',
  )!;
  action.value = button.dataset.deleteAction!;
  id.name = button.dataset.entityField!;
  id.value = button.dataset.entityId!;
  version.value = button.dataset.entityVersion || '';
  dialog.querySelector('#delete-confirmation-title')!.textContent =
    button.dataset.deleteTitle!;
  dialog.querySelector('#delete-confirmation-description')!.textContent =
    button.dataset.deleteDescription!;
  dialog.querySelector('[data-delete-submit]')!.textContent =
    button.dataset.deleteLabel!;
  button.closest('details')?.removeAttribute('open');
  dialog.showModal();
});
