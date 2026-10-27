import relativeLinksRule from "markdownlint-rule-relative-links";

export default {
  config: {
    default: true,
    // Prose stays on one source line per paragraph; the renderer handles wrapping.
    MD013: false,
    "relative-links": { root_path: "." },
  },
  customRules: [relativeLinksRule],
  globs: ["**/*.md"],
  gitignore: true,
  ignores: [
    ".patricktree-stack/**",
    // Claude Code subagent worktrees are excluded in .git/info/exclude, which `gitignore` does not read.
    ".claude/worktrees/**",
  ],
};
