# Cup brand assets

Edit `assets/cup.svg` for the native app icons, splash screens, web favicon, and touch/social icon. `assets/cup-dark.svg` is the separate dark-mode web favicon. Keep their artwork coordinated when changing the logo.

`assets/outputs.json` defines raster output paths, sizes, padding through `markSize`, and transparency. Platform assets remain checked in so Xcode and Android Studio can build directly. Treat those generated files as outputs and edit the sources here.

From the repository root:

```sh
pnpm brand-assets:sync
pnpm brand-assets:check
```

The root commands delegate to the `@cup/brand-assets` package and cover web, Android, and iOS assets together. The web and mobile apps consume the checked-in outputs without depending on the generator.

The web build and native sync use checked-in assets without regenerating them. `pnpm validate:extended` checks assets without writing and reports stale paths with the repair command. Run `pnpm brand-assets:sync` after changing a source and review the generated changes before validation.

The generator also creates Android's `drawable-v24/ic_launcher_foreground.xml`. Its SVG-to-vector conversion supports paths with explicit six-digit hex fills and rejects unsupported SVG features. The raster renderer preserves the complete SVG. Extend vector conversion before introducing shapes or effects that Android cannot currently reproduce. The platform wrappers and white background resources remain native configuration.
