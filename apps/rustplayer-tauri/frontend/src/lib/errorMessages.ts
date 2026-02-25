interface IpcError {
  kind: string;
  message?: string;
  traceId?: string;
}

export function sanitizeError(error: unknown): string {
  // Handle structured IpcError from backend
  if (error && typeof error === 'object' && 'kind' in error) {
    const ipcErr = error as IpcError;
    const detail = ipcErr.message;
    const traceId = ipcErr.traceId;
    switch (ipcErr.kind) {
      case 'network':
        // In release, show fixed message only; detail may contain upstream response bodies.
        return withTraceId(
          import.meta.env.DEV && detail ? `网络错误: ${detail}` : '网络连接失败，请检查网络',
          traceId,
        );
      case 'unauthorized':
        return withTraceId('请先登录', traceId);
      case 'not_found':
        return withTraceId('未找到相关内容', traceId);
      case 'rate_limited':
        return withTraceId('请求过于频繁，请稍后重试', traceId);
      case 'invalid_input':
        return withTraceId(import.meta.env.DEV && detail ? detail : '输入无效', traceId);
      case 'internal':
        return withTraceId(
          import.meta.env.DEV && detail ? `服务异常: ${detail}` : '服务异常，请稍后重试',
          traceId,
        );
      default:
        return withTraceId('操作失败，请重试', traceId);
    }
  }
  // Fallback for string errors
  if (typeof error === 'string') {
    if (error.toLowerCase().includes('network') || error.toLowerCase().includes('fetch')) {
      return '网络连接失败，请检查网络';
    }
    if (error.toLowerCase().includes('unauthorized') || error.toLowerCase().includes('login')) {
      return '请先登录';
    }
  }
  return '操作失败，请重试';
}

function withTraceId(message: string, traceId?: string) {
  if (import.meta.env.DEV && traceId) {
    return `${message} (traceId: ${traceId})`;
  }
  return message;
}
