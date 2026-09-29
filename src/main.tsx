import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { startSync } from "./sync";

// Error Boundary
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '20px',
          color: 'white',
          background: '#030014',
          minHeight: '100vh',
          fontFamily: 'Tajawal, sans-serif',
          direction: 'rtl'
        }}>
          <h1 style={{ color: '#a855f7' }}>حدث خطأ في تحميل التطبيق</h1>
          <p>يرجى تحديث الصفحة أو المحاولة مرة أخرى</p>
          {this.state.error && (
            <pre style={{ 
              background: '#1a1a2e', 
              padding: '10px', 
              borderRadius: '8px',
              overflow: 'auto',
              fontSize: '12px'
            }}>
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById("root")!);

// نجلب بيانات السيرفر المشترك قبل رسم التطبيق حتى يبدأ بآخر نسخة موجودة
startSync().finally(() => {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
});
