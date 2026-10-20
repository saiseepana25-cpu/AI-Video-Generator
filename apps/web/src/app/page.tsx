import {redirect} from 'next/navigation';

// F19 replaces this scaffold entry with the approved public product homepage.
export default function Home() {
  redirect('/projects');
}
