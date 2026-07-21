import type { BiteracerPassage } from "./types";

/**
 * Curated excerpts from public-domain (Project Gutenberg) novels, extracted
 * verbatim from the Gutenberg plain-text editions and normalized for
 * typability. Static data - never fetched or parsed at runtime, so the game
 * has no network dependency and every deploy is fully deterministic.
 *
 * Normalization rules applied to every `text` (repeat them when curating
 * more):
 *  - Single paragraph, no line breaks, ~190-310 characters.
 *  - Smart quotes/dashes/ellipsis normalized to plain ASCII equivalents -
 *    every character is typable from a standard US keyboard layout.
 *  - Gutenberg _italics_ markup stripped; no double spaces; passages with
 *    untypable characters were rejected rather than respelled, so the text
 *    stays a faithful quote.
 *  - `id` is a stable slug for attribution/debugging only - passages are
 *    selected by array index (see game-biteracer.ts), never by id lookup.
 *
 * IMPORTANT: only ever APPEND to this list. Growing it affects future
 * selection cycles only; reordering or replacing entries reshuffles which
 * passage lands on which day.
 */
export const BITERACER_PASSAGES: BiteracerPassage[] = [
  {
    id: "pride-and-prejudice-01",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.",
  },
  {
    id: "pride-and-prejudice-02",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "Mr. Bingley followed his advice. Mr. Darcy walked off; and Elizabeth remained with no very cordial feelings towards him. She told the story, however, with great spirit among her friends; for she had a lively, playful disposition, which delighted in anything ridiculous.",
  },
  {
    id: "pride-and-prejudice-03",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "Lady Lucas was a very good kind of woman, not too clever to be a valuable neighbour to Mrs. Bennet. They had several children. The eldest of them, a sensible, intelligent young woman, about twenty-seven, was Elizabeth's intimate friend.",
  },
  {
    id: "pride-and-prejudice-04",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "He began to wish to know more of her; and, as a step towards conversing with her himself, attended to her conversation with others. His doing so drew her notice. It was at Sir William Lucas's, where a large party were assembled.",
  },
  {
    id: "pride-and-prejudice-05",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "Elizabeth, feeling really anxious, determined to go to her, though the carriage was not to be had: and as she was no horsewoman, walking was her only alternative. She declared her resolution.",
  },
  {
    id: "pride-and-prejudice-06",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "Elizabeth was so much caught by what passed, as to leave her very little attention for her book; and, soon laying it wholly aside, she drew near the card-table, and stationed herself between Mr. Bingley and his eldest sister, to observe the game.",
  },
  {
    id: "pride-and-prejudice-07",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "Mr. Darcy smiled; but Elizabeth thought she could perceive that he was rather offended, and therefore checked her laugh. Miss Bingley warmly resented the indignity he had received, in an expostulation with her brother for talking such nonsense.",
  },
  {
    id: "moby-dick-01",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "It was now about nine o'clock, and the room seeming almost supernaturally quiet after these orgies, I began to congratulate myself upon a little plan that had occurred to me just previous to the entrance of the seamen.",
  },
  {
    id: "moby-dick-02",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "I considered the matter a moment, and then up stairs we went, and I was ushered into a small room, cold as a clam, and furnished, sure enough, with a prodigious bed, almost big enough indeed for any four harpooneers to sleep abreast.",
  },
  {
    id: "moby-dick-03",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "If I had been astonished at first catching a glimpse of so outlandish an individual as Queequeg circulating among the polite society of a civilized town, that astonishment soon departed upon taking my first daylight stroll through the streets of New Bedford.",
  },
  {
    id: "moby-dick-04",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "In this same New Bedford there stands a Whaleman's Chapel, and few are the moody fishermen, shortly bound for the Indian Ocean or Pacific, who fail to make a Sunday visit to the spot. I am sure that I did not.",
  },
  {
    id: "moby-dick-05",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "Nor was the pulpit itself without a trace of the same sea-taste that had achieved the ladder and the picture. Its panelled front was in the likeness of a ship's bluff bows, and the Holy Bible rested on a projecting piece of scroll work, fashioned after a ship's fiddle-headed beak.",
  },
  {
    id: "moby-dick-06",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "He paused a little; then kneeling in the pulpit's bows, folded his large brown hands across his chest, uplifted his closed eyes, and offered a prayer so deeply devout that he seemed kneeling and praying at the bottom of the sea.",
  },
  {
    id: "moby-dick-07",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "His story being ended with his pipe's last dying puff, Queequeg embraced me, pressed his forehead against mine, and blowing out the light, we rolled over from each other, this way and that, and very soon were sleeping.",
  },
  {
    id: "dracula-01",
    book: "Dracula",
    author: "Bram Stoker",
    text: "The light and warmth and the Count's courteous welcome seemed to have dissipated all my doubts and fears. Having then reached my normal state, I discovered that I was half famished with hunger; so making a hasty toilet, I went into the other room.",
  },
  {
    id: "dracula-02",
    book: "Dracula",
    author: "Bram Stoker",
    text: "I went into my own room and drew the curtains, but there was little to notice; my window opened into the courtyard, all I could see was the warm grey of quickening sky. So I pulled the curtains again, and have written of this day.",
  },
  {
    id: "dracula-03",
    book: "Dracula",
    author: "Bram Stoker",
    text: "But I am not in heart to describe beauty, for when I had seen the view I explored further; doors, doors, doors everywhere, and all locked and bolted. In no place save from the windows in the castle walls is there an available exit.",
  },
  {
    id: "dracula-04",
    book: "Dracula",
    author: "Bram Stoker",
    text: "In silence we returned to the library, and after a minute or two I went to my own room. The last I saw of Count Dracula was his kissing his hand to me; with a red light of triumph in his eyes, and with a smile that Judas in hell might be proud of.",
  },
  {
    id: "dracula-05",
    book: "Dracula",
    author: "Bram Stoker",
    text: "But the door would not move. Despair seized me. I pulled, and pulled, at the door, and shook it till, massive as it was, it rattled in its casement. I could see the bolt shot. It had been locked after I left the Count.",
  },
  {
    id: "dracula-06",
    book: "Dracula",
    author: "Bram Stoker",
    text: "Lucy and I sat awhile, and it was all so beautiful before us that we took hands as we sat; and she told me all over again about Arthur and their coming marriage. That made me just a little heart-sick, for I haven't heard from Jonathan for a whole month.",
  },
  {
    id: "dracula-07",
    book: "Dracula",
    author: "Bram Stoker",
    text: "How well the man reasoned; lunatics always do within their own scope. I wonder at how many lives he values a man, or if at only one. He has closed the account most accurately, and to-day begun a new record. How many of us begin a new record with each day of our lives?",
  },
  {
    id: "frankenstein-01",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings. I arrived here yesterday, and my first task is to assure my dear sister of my welfare and increasing confidence in the success of my undertaking.",
  },
  {
    id: "frankenstein-02",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "How slowly the time passes here, encompassed as I am by frost and snow! Yet a second step is taken towards my enterprise. I have hired a vessel and am occupied in collecting my sailors; those whom I have already engaged appear to be men on whom I can depend and are certainly possessed of dauntless courage.",
  },
  {
    id: "frankenstein-03",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "I said in one of my letters, my dear Margaret, that I should find no friend on the wide ocean; yet I have found a man who, before his spirit had been broken by misery, I should have been happy to have possessed as the brother of my heart.",
  },
  {
    id: "frankenstein-04",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "I had sufficient leisure for these and many other reflections during my journey to Ingolstadt, which was long and fatiguing. At length the high white steeple of the town met my eyes. I alighted and was conducted to my solitary apartment to spend the evening as I pleased.",
  },
  {
    id: "frankenstein-05",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "We returned to our college on a Sunday afternoon: the peasants were dancing, and every one we met appeared gay and happy. My own spirits were high, and I bounded along with feelings of unbridled joy and hilarity.",
  },
  {
    id: "frankenstein-06",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "Justine was called on for her defence. As the trial had proceeded, her countenance had altered. Surprise, horror, and misery were strongly expressed. Sometimes she struggled with her tears, but when she was desired to plead, she collected her powers and spoke in an audible although variable voice.",
  },
  {
    id: "frankenstein-07",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "I passed a night of unmingled wretchedness. In the morning I went to the court; my lips and throat were parched. I dared not ask the fatal question, but I was known, and the officer guessed the cause of my visit. The ballots had been thrown; they were all black, and Justine was condemned.",
  },
  {
    id: "sherlock-holmes-01",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "Our visitor glanced with some apparent surprise at the languid, lounging figure of the man who had been no doubt depicted to him as the most incisive reasoner and most energetic agent in Europe. Holmes slowly reopened his eyes and looked impatiently at his gigantic client.",
  },
  {
    id: "sherlock-holmes-02",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "Sherlock Holmes was not very communicative during the long drive and lay back in the cab humming the tunes which he had heard in the afternoon. We rattled through an endless labyrinth of gas-lit streets until we emerged into Farrington Street.",
  },
  {
    id: "sherlock-holmes-03",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "The man sat huddled up in his chair, with his head sunk upon his breast, like one who is utterly crushed. Holmes stuck his feet up on the corner of the mantelpiece and, leaning back with his hands in his pockets, began talking, rather to himself, as it seemed, than to us.",
  },
  {
    id: "sherlock-holmes-04",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "We had the carriage to ourselves save for an immense litter of papers which Holmes had brought with him. Among these he rummaged and read, with intervals of note-taking and of meditation, until we were past Reading. Then he suddenly rolled them all into a gigantic ball and tossed them up onto the rack.",
  },
  {
    id: "sherlock-holmes-05",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "There was no rain, as Holmes had foretold, and the morning broke bright and cloudless. At nine o'clock Lestrade called for us with the carriage, and we set off for Hatherley Farm and the Boscombe Pool.",
  },
  {
    id: "sherlock-holmes-06",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "Sherlock Holmes sat for some time in silence, with his head sunk forward and his eyes bent upon the red glow of the fire. Then he lit his pipe, and leaning back in his chair he watched the blue smoke-rings as they chased each other up to the ceiling.",
  },
  {
    id: "sherlock-holmes-07",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "It had cleared in the morning, and the sun was shining with a subdued brightness through the dim veil which hangs over the great city. Sherlock Holmes was already at breakfast when I came down.",
  },
  {
    id: "alice-in-wonderland-01",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "The rabbit-hole went straight on like a tunnel for some way, and then dipped suddenly down, so suddenly that Alice had not a moment to think about stopping herself before she found herself falling down a very deep well.",
  },
  {
    id: "alice-in-wonderland-02",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "There were doors all round the hall, but they were all locked; and when Alice had been all the way down one side and up the other, trying every door, she walked sadly down the middle, wondering how she was ever to get out again.",
  },
  {
    id: "alice-in-wonderland-03",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "It was high time to go, for the pool was getting quite crowded with the birds and animals that had fallen into it: there were a Duck and a Dodo, a Lory and an Eaglet, and several other curious creatures. Alice led the way, and the whole party swam to the shore.",
  },
  {
    id: "alice-in-wonderland-04",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "This seemed to Alice a good opportunity for making her escape; so she set off at once, and ran till she was quite tired and out of breath, and till the puppy's bark sounded quite faint in the distance.",
  },
  {
    id: "alice-in-wonderland-05",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "She stretched herself up on tiptoe, and peeped over the edge of the mushroom, and her eyes immediately met those of a large blue caterpillar, that was sitting on the top with its arms folded, quietly smoking a long hookah, and taking not the smallest notice of her or of anything else.",
  },
  {
    id: "alice-in-wonderland-06",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "The door led right into a large kitchen, which was full of smoke from one end to the other: the Duchess was sitting on a three-legged stool in the middle, nursing a baby; the cook was leaning over the fire, stirring a large cauldron which seemed to be full of soup.",
  },
  {
    id: "alice-in-wonderland-07",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "When she got back to the Cheshire Cat, she was surprised to find quite a large crowd collected round it: there was a dispute going on between the executioner, the King, and the Queen, who were all talking at once, while all the rest were quite silent, and looked very uncomfortable.",
  },
];
