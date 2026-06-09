---
name: Preview kind fix
description: kind="api" artifacts are excluded from Replit preview pane; migration required to show in preview.
---

The artifact kind field is permanent — verifyAndReplaceArtifactToml will reject kind changes with ARTIFACT_EDITING_ERROR.

**Rule:** kind="api" is invisible in the Replit preview dropdown. Only web, slides, video, mobile, design kinds appear.

**Why:** Replit treats kind="api" as a headless backend service, not a user-facing app.

**How to apply:** If a project starts as kind="api" and later needs to show in the preview pane, create a new artifact using createArtifact() with artifactType="react-vite" (which gives kind="web"), then migrate the Express server code into it:
1. Update old artifact TOML paths away from "/" to free the path
2. createArtifact({ artifactType: "react-vite", slug: "...", previewPath: "/" })
3. Copy all server source, views, public, build.mjs, tsconfig.json into new artifact dir
4. Replace package.json with Express deps (name: @workspace/<slug>)
5. Fix any nested public/ directory from cp -r (check ls artifacts/<slug>/public/)
6. verifyAndReplaceArtifactToml to update service run command (keep integratedSkills block)
7. Update .replit port mapping: localPort = <new port> externalPort = 80
8. pnpm install --filter @workspace/<slug>
9. restart_workflow and presentArtifact
