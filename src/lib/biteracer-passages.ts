import type { BiteracerPassage } from "./types";

/**
 * Placeholder passage pool: standard Lorem Ipsum text, split into
 * typing-test-sized chunks. To be replaced with curated public-domain
 * (Project Gutenberg) novel excerpts later.
 *
 * Normalization rules for every `text` (apply when curating real passages):
 *  - Single paragraph, no line breaks.
 *  - ~40-60 words / ~200-300 characters.
 *  - Smart quotes/dashes/ellipsis normalized to plain ASCII equivalents —
 *    every character must be typable from a standard US keyboard layout.
 *  - No double spaces, no leading/trailing whitespace.
 *  - `id` is a stable slug for attribution/debugging only — passages are
 *    selected by array index (see game-biteracer.ts), never by id lookup.
 *
 * Growing this list only affects future selection cycles; already-played
 * days keep their recorded passageId regardless.
 */
export const BITERACER_PASSAGES: BiteracerPassage[] = [
  {
    id: "lorem-ipsum-01",
    book: "Lorem Ipsum",
    author: "Placeholder",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  },
  {
    id: "lorem-ipsum-02",
    book: "Lorem Ipsum",
    author: "Placeholder",
    text: "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  },
  {
    id: "lorem-ipsum-03",
    book: "Lorem Ipsum",
    author: "Placeholder",
    text: "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
  },
  {
    id: "lorem-ipsum-04",
    book: "Lorem Ipsum",
    author: "Placeholder",
    text: "Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit.",
  },
  {
    id: "lorem-ipsum-05",
    book: "Lorem Ipsum",
    author: "Placeholder",
    text: "Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur.",
  },
  {
    id: "lorem-ipsum-06",
    book: "Lorem Ipsum",
    author: "Placeholder",
    text: "At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi.",
  },
  {
    id: "lorem-ipsum-07",
    book: "Lorem Ipsum",
    author: "Placeholder",
    text: "Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.",
  },
  {
    id: "lorem-ipsum-08",
    book: "Lorem Ipsum",
    author: "Placeholder",
    text: "Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur.",
  },
];
