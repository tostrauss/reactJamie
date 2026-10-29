const noop = () => {};
export const useToast = () => ({ success: noop, error: noop, info: noop });
export const ToastProvider = ({ children }) => children;
