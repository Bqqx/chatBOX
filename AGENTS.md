# Project Agent Guide

This file records project-specific instructions for future Codex sessions.
Read it before making changes in this repository.

## Project Context

- This project is a customized fork of NextChat for chat, image generation, and resource management.
- The final target includes mobile use and Android APK packaging, so mobile layout and interaction quality are important.
- The user often tests UI manually. For normal feature changes, do not proactively open the browser unless the user asks. After finishing, report what changed and list what the user should test.

## Standing User Instructions

- Do not commit local startup helper scripts such as `start-dev.bat` or `start-dev.ps1`.
- Before committing, check that API keys, relay keys, tokens, and other secrets are not exposed.
- External plugin folders provided by the user, such as ComfyUI custom node folders, are reference-only. Do not modify them unless the user explicitly asks.
- Prefer reusing existing shared components. For example, image preview behavior should be implemented in the shared preview component so resource management and image chat stay consistent.
- Treat mobile as a primary target. Use mobile-friendly navigation, back buttons, stable layouts, and touch-safe controls instead of shrinking desktop interactions.

## Common Pitfalls To Avoid

- Do not hide interactive controls only with CSS opacity or hover state if they can still be clicked. If a control should not be available, remove it from the rendered DOM or disable pointer events.
- Do not blindly reuse chat-page hover/action components in image-chat pages. Chat message actions often carry desktop hover behavior, toast behavior, or model-selection side effects that do not fit image generation.
- Be careful with automatic model correction logic. Do not show model toast messages or silently switch models when the user is using a relay/custom model flow.
- In relay mode, do not beautify, alias, or rewrite user-provided model names unless the exact relay protocol requires it. Prefer passing the model name exactly as the user configured it.
- Keep official API configuration and relay/proxy configuration conceptually separate when making request logic changes. Avoid mixing provider defaults with custom relay URL, key, and model name.
- For image display, do not force generated images into fixed-ratio boxes. Show the full image at its natural aspect ratio, only constrained by available max width/height.
- For image deletion/hiding flows, verify the intended behavior before changing store data. Some actions only remove an item from the conversation view, while other actions delete the actual image resource.
- Before committing, remember that the repository runs lint-staged hooks. Avoid naming ordinary functions with a `use*` prefix unless they are real React hooks.

## Validation Preferences

- Static checks are useful:
  - `npx tsc --noEmit`
  - `git diff --check`
- Browser/UI testing should be left to the user unless they explicitly ask for it. Do not proactively run the in-app Browser, browser click tests, screenshots, or manual UI automation for ordinary feature changes.
- When reporting completion, include a concise manual test checklist instead of saying the UI is fully verified.

## Git Notes

- Do not use destructive git commands such as `git reset --hard` or `git checkout --` unless the user explicitly requests them.
- Do not revert unrelated changes.
- When committing, stage only relevant files. Keep startup scripts and local-only helpers untracked unless the user asks otherwise.
