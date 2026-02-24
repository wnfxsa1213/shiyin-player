import { createPortal } from 'react-dom';
import { useToastStore, type ToastType } from '@/store/toastStore';
import { CheckCircle, XCircle, Info } from 'lucide-react';

const iconMap: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="text-success w-5 h-5 flex-shrink-0" />,
  error: <XCircle className="text-error w-5 h-5 flex-shrink-0" />,
  info: <Info className="text-info w-5 h-5 flex-shrink-0" />,
};

const colorMap: Record<ToastType, string> = {
  success: 'bg-success',
  error: 'bg-error',
  info: 'bg-info',
};

export default function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  return createPortal(
    <div role="status" aria-live="polite" className="fixed top-4 right-4 z-[200] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className="pointer-events-auto relative flex items-center gap-3 px-4 py-3 rounded-xl bg-bg-elevated/95 backdrop-blur-lg border border-border-primary shadow-lg min-w-[280px] max-w-[400px] text-sm animate-slide-in-right overflow-hidden"
        >
          <div className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full ${colorMap[toast.type]}`} />
          {iconMap[toast.type]}
          <span className="text-text-primary break-words flex-1">{toast.message}</span>
          <button onClick={() => removeToast(toast.id)} className="p-0.5 rounded text-text-tertiary hover:text-text-primary transition-colors cursor-pointer flex-shrink-0" aria-label="关闭通知">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
