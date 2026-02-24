import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export default function BackButton() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(-1)}
      className="sticky top-0 z-10 flex items-center gap-1 px-2 py-2 text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
      aria-label="返回"
    >
      <ChevronLeft size={20} strokeWidth={1.5} />
      <span className="text-sm">返回</span>
    </button>
  );
}
