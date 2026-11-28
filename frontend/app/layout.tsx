import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gönüllü Hesaplama",
  description: "Tarayıcı tabanlı gönüllü hesaplama platformu — ajan, graf kontrol merkezi ve x402 ödemeleri.",
};

const nav = [
  { href: "/", label: "Gönüllü" },
  { href: "/panel", label: "Panel" },
  { href: "/kontrol", label: "Kontrol" },
  { href: "/benchmark", label: "Kıyas" },
];

// Koyu temayı ilk boyamadan önce ayarla (flash yok): sistem tercihini izler.
const themeScript = `try{var m=matchMedia('(prefers-color-scheme: dark)');var set=function(){document.documentElement.classList.toggle('dark',m.matches)};set();m.addEventListener('change',set)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <header className="border-b bg-card/50 backdrop-blur">
          <div className="container flex h-14 items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
              Gönüllü Hesaplama
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="container py-8">{children}</main>
      </body>
    </html>
  );
}
