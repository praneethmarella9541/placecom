import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Placecom",
  description:
    "Mail, contact extraction, recruiter CRM, calendar, calls, and meeting notes in one workspace.",
};

const themeInitScript = `(function(){try{var t=localStorage.getItem('placecom-theme')||localStorage.getItem('theme');var dark=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',dark?'dark':'light');if(dark)document.documentElement.classList.add('dark');else document.documentElement.classList.remove('dark')}catch(e){}})()`;

const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link
          href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800&f[]=satoshi@400,500,700&display=swap"
          rel="stylesheet"
        />
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
