import './globals.css';

export const metadata = {
  title: 'BriefBot — Briefing Stratégique IA',
  description: 'Outil de collecte de brief IA pour refontes de sites web, SEO & stratégie digitale',
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
