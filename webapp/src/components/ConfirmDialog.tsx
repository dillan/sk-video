import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A small, reusable confirm dialog for a deliberate/destructive action — sign-out is the first user.
 * It follows the app's honesty rules and the Apple-style alert anatomy: the safe action takes default
 * focus so a stray Enter can never confirm, Escape and a backdrop click cancel, and the destructive
 * button is the red-tinted one (red is allowed here — a destructive confirm — never for auth status).
 * The confirm sits left, the safe action right, so reading only the buttons makes the choice clear.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="confirm"
      data-testid="confirm-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel(); // a click on the backdrop, not the card
      }}
    >
      <div className="confirm__card" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="confirm__title">
          {title}
        </h2>
        {body && <p className="confirm__body">{body}</p>}
        <div className="confirm__actions">
          <button
            type="button"
            className={`iconbtn iconbtn--wide${destructive ? ' btn--danger' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="iconbtn iconbtn--wide"
            ref={cancelRef}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
