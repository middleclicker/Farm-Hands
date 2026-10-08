# Accessibility

Farm Hands is a visual 3D game. The current interface includes labeled buttons, keyboard shortcuts, visible focus for many controls, a status region for game messages, and a reduced-motion media query for decorative effects. The plot action menu, farmhouse journal, settings, inventory, and shop expose text or accessible names.

## Known limits

- The 3D field and zoning view are canvas-based. Screen reader users cannot yet inspect every terrain feature or draw a field without using the visual scene.
- Some instructions depend on color and 3D position. The cleanup panel gives text and numerical progress, but it does not provide a complete nonvisual route through cleanup.
- The map is visual and supports pointer panning and zoom controls; it does not yet expose each map cell as keyboard navigable content.

We do not claim WCAG conformance yet. Please file an [accessibility issue](https://github.com/middleclicker/Farm-Hands/issues/new/choose) with the task you attempted, browser, assistive technology if used, and what made it difficult. Avoid including private information. Contributions that make zoning, cleanup, or map inspection usable without a pointer are especially valuable.
