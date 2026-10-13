# Creative discovery provenance

Source: [obra/superpowers brainstorming skill](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/brainstorming/SKILL.md), commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (last relevant file revision visible in the GitHub history when checked on 2026-10-14). The upstream repository is [MIT licensed](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/LICENSE).

The product uses the _method_: ask one focused question, distinguish user facts from suggestions, surface assumptions, summarize a brief, and require explicit confirmation before generating paid media. `main/videoCreation/discovery/prompt.ts` and its workflow are original application code and prompts; no source text from the skill is copied or executed at runtime. The skill's software-development instructions (planning, subagents, commits and reviews) are deliberately absent from the customer-facing workflow.

The runtime sends only the project's story context to the selected LLM provider. Imported scripts and user text are treated as data. The approval and request count are saved per project, episode and writing provider so later steps do not silently restart a budget session.
