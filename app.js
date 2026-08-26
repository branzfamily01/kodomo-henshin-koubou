// Loader kept for compatibility with the original single-file build.
(() => {
  const core = document.createElement('script');
  core.src = 'app-core.js';
  core.onload = () => {
    const studio = document.createElement('script');
    studio.src = 'app-studio.js';
    document.body.appendChild(studio);
  };
  document.body.appendChild(core);
})();
