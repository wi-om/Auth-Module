import toast from 'react-hot-toast';

export function toastError(message: string): void {
  toast.error(message, { duration: 5000 });
}

export function toastSuccess(message: string): void {
  toast.success(message, { duration: 4000 });
}

export function toastFromError(e: unknown, fallback: string): void {
  toastError(e instanceof Error ? e.message : fallback);
}
