import type {Metadata} from 'next';
import '@fontsource/sora/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/noto-sans-telugu/400.css';
import '@fontsource/noto-sans-telugu/500.css';
import './globals.css';

export const metadata: Metadata = {
  title: {default: 'VideoCraft — Studio', template: '%s | VideoCraft'},
  description: 'A shared studio for educational motion explainers in English and Telugu.',
  robots: {index: false, follow: false},
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
