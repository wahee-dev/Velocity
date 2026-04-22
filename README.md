  ┌─────────────────────┬────────────────────────────────────────────────────────┐      
  │       Command       │                      What it does                      │      
  ├─────────────────────┼────────────────────────────────────────────────────────┤      
  │ bun run dev         │ Start Vite dev server (frontend only, no Tauri window) │      
  ├─────────────────────┼────────────────────────────────────────────────────────┤
  │ bun run build       │ Type-check + production build (outputs to dist/)       │      
  ├─────────────────────┼────────────────────────────────────────────────────────┤      
  │ bun run preview     │ Preview the production build locally                   │      
  ├─────────────────────┼────────────────────────────────────────────────────────┤      
  │ bun run tauri dev   │ Full app with hot-reload (Tauri + Vite)                │      
  ├─────────────────────┼────────────────────────────────────────────────────────┤      
  │ bun run tauri build │ Production build of the full desktop app               │      
  └─────────────────────┴────────────────────────────────────────────────────────┘

Making Future Releases

  After you've made changes and want to release a new version:

  # 1. Commit your changes
  git add .
  git commit -m "Added dark mode and bug fixes"

  # 2. Push the code
  git push

  # 3. Create and push a new tag
  git tag v0.2.0
  git push origin v0.2.0

  That's it. Every time you push a v* tag, a new release is built automatically. 