import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { getSession } from "./api.js";
import "./styles.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div className="fatal-error"><span className="brand-mark">P</span><h1>Không thể hiển thị trang</h1><p>Một thành phần gặp lỗi, nhưng dữ liệu của bạn vẫn an toàn.</p><button className="button primary" onClick={() => window.location.reload()}>Tải lại hệ thống</button></div>;
    }
    return this.props.children;
  }
}

function Bootstrap() {
  const [state, setState] = useState({ loading: true, user: null, error: "" });

  useEffect(() => {
    getSession()
      .then((user) => setState({ loading: false, user, error: "" }))
      .catch((error) => setState({ loading: false, user: null, error: error.message }));
  }, []);

  if (state.loading) return <div className="boot"><span className="brand-mark">P</span><span>Đang khởi động hệ thống...</span></div>;
  if (state.error) return <div className="boot boot-error"><strong>Chưa thể khởi động</strong><span>{state.error}</span></div>;
  return <App initialUser={state.user} />;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><ErrorBoundary><Bootstrap /></ErrorBoundary></React.StrictMode>);
