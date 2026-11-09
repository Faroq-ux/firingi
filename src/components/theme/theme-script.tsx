/**
 * Runs before first paint so "system" users never see a flash of the wrong theme.
 * (Explicit light / dark is already rendered by the server from the cookie.)
 */
export function ThemeScript() {
  const js = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]+)/);var c=m?m[1]:"system";if(c==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.classList.add("dark");}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
