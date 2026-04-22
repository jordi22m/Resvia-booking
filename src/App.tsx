import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import CalendarPage from "@/pages/CalendarPage";
import ServicesPage from "@/pages/ServicesPage";
import CustomersPage from "@/pages/CustomersPage";
import BookingLinkPage from "@/pages/BookingLinkPage";
import ReportsPage from "@/pages/ReportsPage";
import WebhooksPage from "@/pages/WebhooksPage";
import SettingsPage from "@/pages/SettingsPage";
import BookingPage from "@/pages/BookingPage";
import BookingCancelPage from "@/pages/BookingCancelPage";
import BookingReschedulePage from "@/pages/BookingReschedulePage";
import BookingDebugPage from "@/pages/BookingDebugPage";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import Index from "@/pages/Index";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      retryDelay: 500,
      // 'always' avoids stalling on WhatsApp/in-app browsers that report
      // navigator.onLine incorrectly while the network is actually available.
      networkMode: 'always',
    },
  },
});

const ProtectedApp = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <AppLayout>{children}</AppLayout>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/registro" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/book/:slug" element={<BookingPage />} />
            <Route path="/booking/cancel/:token" element={<BookingCancelPage />} />
            <Route path="/booking/reschedule/:token" element={<BookingReschedulePage />} />
            <Route path="/debug" element={<BookingDebugPage />} />

            {/* Protected routes */}
            <Route path="/" element={<Index />} />
            <Route path="/dashboard" element={<ProtectedApp><Dashboard /></ProtectedApp>} />
            <Route path="/calendar" element={<ProtectedApp><CalendarPage /></ProtectedApp>} />
            <Route path="/services" element={<ProtectedApp><ServicesPage /></ProtectedApp>} />
            <Route path="/customers" element={<ProtectedApp><CustomersPage /></ProtectedApp>} />
            <Route path="/booking-link" element={<ProtectedApp><BookingLinkPage /></ProtectedApp>} />
            <Route path="/reports" element={<ProtectedApp><ReportsPage /></ProtectedApp>} />
            <Route path="/webhooks" element={<ProtectedApp><WebhooksPage /></ProtectedApp>} />
            <Route path="/settings" element={<ProtectedApp><SettingsPage /></ProtectedApp>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
