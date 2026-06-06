import type { Metadata } from "next";
import { Sora, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sora",
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Nucleus",
  description:
    "Mail, contact extraction, recruiter CRM, calendar, calls, and meeting notes in one workspace.",
  icons: {
    icon: "/favicon.png",
  },
};

const themeInitScript = `(function(){try{var t=localStorage.getItem('nucleus-theme')||localStorage.getItem('placecom-theme')||localStorage.getItem('theme');var dark=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',dark?'dark':'light');if(dark)document.documentElement.classList.add('dark');else document.documentElement.classList.remove('dark')}catch(e){}})()`;

const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sora.variable} ${plusJakartaSans.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {googleClientId ? (
          <>
            <link rel="preconnect" href="https://accounts.google.com" />
            <link rel="preconnect" href="https://apis.google.com" />
            <meta name="google-signin-client_id" content={googleClientId} />
          </>
        ) : null}
      </head>
      <body className="min-h-screen text-[15px] leading-relaxed antialiased">
        {children}
      </body>
    </html>
  );
}
