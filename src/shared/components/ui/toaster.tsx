import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="top-center"
      richColors
      closeButton
      expand={false}
      toastOptions={{
        style: {
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-container)",
          color: "var(--color-text-primary)",
          boxShadow: "0 6px 18px rgba(26, 26, 26, 0.08)",
          maxWidth: "420px",
        },
        descriptionClassName:
          "max-h-48 overflow-auto whitespace-pre-wrap text-xs text-[var(--color-text-secondary)] [overflow-wrap:anywhere]",
      }}
      {...props}
    />
  );
}

export { Toaster };
