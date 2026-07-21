import type { BiteracerPassage } from "./types";

/**
 * Curated excerpts from public-domain (Project Gutenberg) novels, extracted
 * verbatim from the Gutenberg plain-text editions and normalized for
 * typability. Static data - never fetched or parsed at runtime, so the game
 * has no network dependency and every deploy is fully deterministic.
 *
 * Normalization rules applied to every `text` (repeat them when curating
 * more):
 *  - Single paragraph, no line breaks, ~380-620 characters.
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
    text: "Mr. Bennet was so odd a mixture of quick parts, sarcastic humour, reserve, and caprice, that the experience of three-and-twenty years had been insufficient to make his wife understand his character. Her mind was less difficult to develope. She was a woman of mean understanding, little information, and uncertain temper. When she was discontented, she fancied herself nervous. The business of her life was to get her daughters married: its solace was visiting and news.",
  },
  {
    id: "pride-and-prejudice-02",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "In a few days Mr. Bingley returned Mr. Bennet's visit, and sat about ten minutes with him in his library. He had entertained hopes of being admitted to a sight of the young ladies, of whose beauty he had heard much; but he saw only the father. The ladies were somewhat more fortunate, for they had the advantage of ascertaining, from an upper window, that he wore a blue coat and rode a black horse.",
  },
  {
    id: "pride-and-prejudice-03",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "Mr. Bingley inherited property to the amount of nearly a hundred thousand pounds from his father, who had intended to purchase an estate, but did not live to do it. Mr. Bingley intended it likewise, and sometimes made choice of his county; but, as he was now provided with a good house and the liberty of a manor, it was doubtful to many of those who best knew the easiness of his temper, whether he might not spend the remainder of his days at Netherfield, and leave the next generation to purchase.",
  },
  {
    id: "pride-and-prejudice-04",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "She did at last extort from her father an acknowledgment that the horses were engaged; Jane was therefore obliged to go on horseback, and her mother attended her to the door with many cheerful prognostics of a bad day. Her hopes were answered; Jane had not been gone long before it rained hard. Her sisters were uneasy for her, but her mother was delighted. The rain continued the whole evening without intermission; Jane certainly could not come back.",
  },
  {
    id: "pride-and-prejudice-05",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "In Meryton they parted: the two youngest repaired to the lodgings of one of the officers' wives, and Elizabeth continued her walk alone, crossing field after field at a quick pace, jumping over stiles and springing over puddles, with impatient activity, and finding herself at last within view of the house, with weary ancles, dirty stockings, and a face glowing with the warmth of exercise.",
  },
  {
    id: "pride-and-prejudice-06",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "Elizabeth took up some needlework, and was sufficiently amused in attending to what passed between Darcy and his companion. The perpetual commendations of the lady either on his hand-writing, or on the evenness of his lines, or on the length of his letter, with the perfect unconcern with which her praises were received, formed a curious dialogue, and was exactly in unison with her opinion of each.",
  },
  {
    id: "pride-and-prejudice-07",
    book: "Pride and Prejudice",
    author: "Jane Austen",
    text: "When the ladies removed after dinner Elizabeth ran up to her sister, and seeing her well guarded from cold, attended her into the drawing-room, where she was welcomed by her two friends with many professions of pleasure; and Elizabeth had never seen them so agreeable as they were during the hour which passed before the gentlemen appeared. Their powers of conversation were considerable. They could describe an entertainment with accuracy, relate an anecdote with humour, and laugh at their acquaintance with spirit.",
  },
  {
    id: "moby-dick-01",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "I stuffed a shirt or two into my old carpet-bag, tucked it under my arm, and started for Cape Horn and the Pacific. Quitting the good city of old Manhatto, I duly arrived in New Bedford. It was a Saturday night in December. Much was I disappointed upon learning that the little packet for Nantucket had already sailed, and that no way of reaching that place would offer, till the following Monday.",
  },
  {
    id: "moby-dick-02",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "In fact, the artist's design seemed this: a final theory of my own, partly based upon the aggregated opinions of many aged persons with whom I conversed upon the subject. The picture represents a Cape-Horner in a great hurricane; the half-foundered ship weltering there with its three dismantled masts alone visible; and an exasperated whale, purposing to spring clean over the craft, is in the enormous act of impaling himself upon the three mast-heads.",
  },
  {
    id: "moby-dick-03",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "However, a good laugh is a mighty good thing, and rather too scarce a good thing; the more's the pity. So, if any one man, in his own proper person, afford stuff for a good joke to anybody, let him not be backward, but let him cheerfully allow himself to spend and be spent in that way. And the man that has anything bountifully laughable about him, be sure there is more in that man than you perhaps think for.",
  },
  {
    id: "moby-dick-04",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "The bar-room was now full of the boarders who had been dropping in the night previous, and whom I had not as yet had a good look at. They were nearly all whalemen; chief mates, and second mates, and third mates, and sea carpenters, and sea coopers, and sea blacksmiths, and harpooneers, and ship keepers; a brown and brawny company, with bosky beards; an unshorn, shaggy set, all wearing monkey jackets for morning gowns.",
  },
  {
    id: "moby-dick-05",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "And the women of New Bedford, they bloom like their own red roses. But roses only bloom in summer; whereas the fine carnation of their cheeks is perennial as sunlight in the seventh heavens. Elsewhere match that bloom of theirs, ye cannot, save in Salem, where they tell me the young girls breathe such musk, their sailor sweethearts smell them miles off shore, as though they were drawing nigh the odorous Moluccas instead of the Puritanic sands.",
  },
  {
    id: "moby-dick-06",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "While he was speaking these words, the howling of the shrieking, slanting storm without seemed to add new power to the preacher, who, when describing Jonah's sea-storm, seemed tossed by a storm himself. His deep chest heaved as with a ground-swell; his tossed arms seemed the warring elements at work; and the thunders that rolled away from off his swarthy brow, and the light leaping from his eye, made all his simple hearers look on him with a quick fear that was strange to them.",
  },
  {
    id: "moby-dick-07",
    book: "Moby-Dick",
    author: "Herman Melville",
    text: "We then turned over the book together, and I endeavored to explain to him the purpose of the printing, and the meaning of the few pictures that were in it. Thus I soon engaged his interest; and from that we went to jabbering the best we could about the various outer sights to be seen in this famous town. Soon I proposed a social smoke; and, producing his pouch and tomahawk, he quietly offered me a puff. And then we sat exchanging puffs from that wild pipe of his, and keeping it regularly passing between us.",
  },
  {
    id: "dracula-01",
    book: "Dracula",
    author: "Bram Stoker",
    text: "How these papers have been placed in sequence will be made manifest in the reading of them. All needless matters have been eliminated, so that a history almost at variance with the possibilities of later-day belief may stand forth as simple fact. There is throughout no statement of past things wherein memory may err, for all the records chosen are exactly contemporary, given from the standpoints and within the range of knowledge of those who made them.",
  },
  {
    id: "dracula-02",
    book: "Dracula",
    author: "Bram Stoker",
    text: "Presently, with an excuse, he left me, asking me to put all my papers together. He was some little time away, and I began to look at some of the books around me. One was an atlas, which I found opened naturally at England, as if that map had been much used. On looking at it I found in certain places little rings marked, and on examining these I noticed that one was near London on the east side, manifestly where his new estate was situated; the other two were Exeter, and Whitby on the Yorkshire coast.",
  },
  {
    id: "dracula-03",
    book: "Dracula",
    author: "Bram Stoker",
    text: "Then a wild desire took me to obtain that key at any risk, and I determined then and there to scale the wall again and gain the Count's room. He might kill me, but death now seemed the happier choice of evils. Without a pause I rushed up to the east window, and scrambled down the wall, as before, into the Count's room. It was empty, but that was as I expected. I could not see a key anywhere, but the heap of gold remained. I went through the door in the corner and down the winding stair and along the dark passage to the old chapel. I knew now well enough where to find the monster I sought.",
  },
  {
    id: "dracula-04",
    book: "Dracula",
    author: "Bram Stoker",
    text: "The harbour lies below me, with, on the far side, one long granite wall stretching out into the sea, with a curve outwards at the end of it, in the middle of which is a lighthouse. A heavy sea-wall runs along outside of it. On the near side, the sea-wall makes an elbow crooked inversely, and its end too has a lighthouse. Between the two piers there is a narrow opening into the harbour, which then suddenly widens.",
  },
  {
    id: "dracula-05",
    book: "Dracula",
    author: "Bram Stoker",
    text: "Shortly before ten o'clock the stillness of the air grew quite oppressive, and the silence was so marked that the bleating of a sheep inland or the barking of a dog in the town was distinctly heard, and the band on the pier, with its lively French air, was like a discord in the great harmony of nature's silence. A little after midnight came a strange sound from over the sea, and high overhead the air began to carry a strange, faint, hollow booming.",
  },
  {
    id: "dracula-06",
    book: "Dracula",
    author: "Bram Stoker",
    text: "She moved off into her boudoir, where she usually breakfasted early. As she had spoken, I watched the Professor's face, and saw it turn ashen grey. He had been able to retain his self-command whilst the poor lady was present, for he knew her state and how mischievous a shock would be; he actually smiled on her as he held open the door for her to pass into her room. But the instant she had disappeared he pulled me, suddenly and forcibly, into the dining-room and closed the door.",
  },
  {
    id: "dracula-07",
    book: "Dracula",
    author: "Bram Stoker",
    text: "Presently he took an opportunity of telling Mrs. Westenra that she must not remove anything from Lucy's room without consulting him; that the flowers were of medicinal value, and that the breathing of their odour was a part of the system of cure. Then he took over the care of the case himself, saying that he would watch this night and the next and would send me word when to come.",
  },
  {
    id: "frankenstein-01",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "These visions faded when I perused, for the first time, those poets whose effusions entranced my soul and lifted it to heaven. I also became a poet and for one year lived in a paradise of my own creation; I imagined that I also might obtain a niche in the temple where the names of Homer and Shakespeare are consecrated. You are well acquainted with my failure and how heavily I bore the disappointment. But just at that time I inherited the fortune of my cousin, and my thoughts were turned into the channel of their earlier bent.",
  },
  {
    id: "frankenstein-02",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "I shall depart for the latter town in a fortnight or three weeks; and my intention is to hire a ship there, which can easily be done by paying the insurance for the owner, and to engage as many sailors as I think necessary among those who are accustomed to the whale-fishing. I do not intend to sail until the month of June; and when shall I return? Ah, dear sister, how can I answer this question? If I succeed, many, many months, perhaps years, will pass before you and I may meet. If I fail, you will see me again soon, or never.",
  },
  {
    id: "frankenstein-03",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "Such is my journal of what relates to this strange occurrence up to the present day. The stranger has gradually improved in health but is very silent and appears uneasy when anyone except myself enters his cabin. Yet his manners are so conciliating and gentle that the sailors are all interested in him, although they have had very little communication with him. For my own part, I begin to love him as a brother, and his constant and deep grief fills me with sympathy and compassion. He must have been a noble creature in his better days, being even now in wreck so attractive and amiable.",
  },
  {
    id: "frankenstein-04",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "Even broken in spirit as he is, no one can feel more deeply than he does the beauties of nature. The starry sky, the sea, and every sight afforded by these wonderful regions seem still to have the power of elevating his soul from earth. Such a man has a double existence: he may suffer misery and be overwhelmed by disappointments, yet when he has retired into himself, he will be like a celestial spirit that has a halo around him, within whose circle no grief or folly ventures.",
  },
  {
    id: "frankenstein-05",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "I am by birth a Genevese, and my family is one of the most distinguished of that republic. My ancestors had been for many years counsellors and syndics, and my father had filled several public situations with honour and reputation. He was respected by all who knew him for his integrity and indefatigable attention to public business. He passed his younger days perpetually occupied by the affairs of his country; a variety of circumstances had prevented his marrying early, nor was it until the decline of life that he became a husband and the father of a family.",
  },
  {
    id: "frankenstein-06",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "Several months passed in this manner. Her father grew worse; her time was more entirely occupied in attending him; her means of subsistence decreased; and in the tenth month her father died in her arms, leaving her an orphan and a beggar. This last blow overcame her, and she knelt by Beaufort's coffin weeping bitterly, when my father entered the chamber. He came like a protecting spirit to the poor girl, who committed herself to his care; and after the interment of his friend he conducted her to Geneva and placed her under the protection of a relation. Two years after this event Caroline became his wife.",
  },
  {
    id: "frankenstein-07",
    book: "Frankenstein",
    author: "Mary Shelley",
    text: "No human being could have passed a happier childhood than myself. My parents were possessed by the very spirit of kindness and indulgence. We felt that they were not the tyrants to rule our lot according to their caprice, but the agents and creators of all the many delights which we enjoyed. When I mingled with other families I distinctly discerned how peculiarly fortunate my lot was, and gratitude assisted the development of filial love.",
  },
  {
    id: "sherlock-holmes-01",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "It was close upon four before the door opened, and a drunken-looking groom, ill-kempt and side-whiskered, with an inflamed face and disreputable clothes, walked into the room. Accustomed as I was to my friend's amazing powers in the use of disguises, I had to look three times before I was certain that it was indeed he. With a nod he vanished into the bedroom, whence he emerged in five minutes tweed-suited and respectable, as of old. Putting his hands into his pockets, he stretched out his legs in front of the fire and laughed heartily for some minutes.",
  },
  {
    id: "sherlock-holmes-02",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "He disappeared into his bedroom and returned in a few minutes in the character of an amiable and simple-minded Nonconformist clergyman. His broad black hat, his baggy trousers, his white tie, his sympathetic smile, and general look of peering and benevolent curiosity were such as Mr. John Hare alone could have equalled. It was not merely that Holmes changed his costume. His expression, his manner, his very soul seemed to vary with every fresh part that he assumed. The stage lost a fine actor, even as science lost an acute reasoner, when he became a specialist in crime.",
  },
  {
    id: "sherlock-holmes-03",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "The portly client puffed out his chest with an appearance of some little pride and pulled a dirty and wrinkled newspaper from the inside pocket of his greatcoat. As he glanced down the advertisement column, with his head thrust forward and the paper flattened out upon his knee, I took a good look at the man and endeavoured, after the fashion of my companion, to read the indications which might be presented by his dress or appearance.",
  },
  {
    id: "sherlock-holmes-04",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "It was a quarter-past nine when I started from home and made my way across the Park, and so through Oxford Street to Baker Street. Two hansoms were standing at the door, and as I entered the passage I heard the sound of voices from above. On entering his room, I found Holmes in animated conversation with two men, one of whom I recognised as Peter Jones, the official police agent, while the other was a long, thin, sad-faced man, with a very shiny hat and oppressively respectable frock-coat.",
  },
  {
    id: "sherlock-holmes-05",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "Sherlock Holmes sat silent for a few minutes with his fingertips still pressed together, his legs stretched out in front of him, and his gaze directed upward to the ceiling. Then he took down from the rack the old and oily clay pipe, which was to him as a counsellor, and, having lit it, he leaned back in his chair, with the thick blue cloud-wreaths spinning up from him, and a look of infinite languor in his face.",
  },
  {
    id: "sherlock-holmes-06",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "It was nearly four o'clock when we at last, after passing through the beautiful Stroud Valley, and over the broad gleaming Severn, found ourselves at the pretty little country-town of Ross. A lean, ferret-like man, furtive and sly-looking, was waiting for us upon the platform. In spite of the light brown dustcoat and leather-leggings which he wore in deference to his rustic surroundings, I had no difficulty in recognising Lestrade, of Scotland Yard. With him we drove to the Hereford Arms where a room had already been engaged for us.",
  },
  {
    id: "sherlock-holmes-07",
    book: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    text: "We made our way downstairs as quietly as possible, and out into the bright morning sunshine. In the road stood our horse and trap, with the half-clad stable-boy waiting at the head. We both sprang in, and away we dashed down the London Road. A few country carts were stirring, bearing in vegetables to the metropolis, but the lines of villas on either side were as silent and lifeless as some city in a dream.",
  },
  {
    id: "alice-in-wonderland-01",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "Suddenly she came upon a little three-legged table, all made of solid glass; there was nothing on it except a tiny golden key, and Alice's first thought was that it might belong to one of the doors of the hall; but, alas! either the locks were too large, or the key was too small, but at any rate it would not open any of them. However, on the second time round, she came upon a low curtain she had not noticed before, and behind it was a little door about fifteen inches high: she tried the little golden key in the lock, and to her great delight it fitted!",
  },
  {
    id: "alice-in-wonderland-02",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "After a while, finding that nothing more happened, she decided on going into the garden at once; but, alas for poor Alice! when she got to the door, she found she had forgotten the little golden key, and when she went back to the table for it, she found she could not possibly reach it: she could see it quite plainly through the glass, and she tried her best to climb up one of the legs of the table, but it was too slippery; and when she had tired herself out with trying, the poor little thing sat down and cried.",
  },
  {
    id: "alice-in-wonderland-03",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "So she swallowed one of the cakes, and was delighted to find that she began shrinking directly. As soon as she was small enough to get through the door, she ran out of the house, and found quite a crowd of little animals and birds waiting outside. The poor little Lizard, Bill, was in the middle, being held up by two guinea-pigs, who were giving it something out of a bottle. They all made a rush at Alice the moment she appeared; but she ran off as hard as she could, and soon found herself safe in a thick wood.",
  },
  {
    id: "alice-in-wonderland-04",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "The great question certainly was, what? Alice looked all round her at the flowers and the blades of grass, but she did not see anything that looked like the right thing to eat or drink under the circumstances. There was a large mushroom growing near her, about the same height as herself; and when she had looked under it, and on both sides of it, and behind it, it occurred to her that she might as well look and see what was on the top of it.",
  },
  {
    id: "alice-in-wonderland-05",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "As there seemed to be no chance of getting her hands up to her head, she tried to get her head down to them, and was delighted to find that her neck would bend about easily in any direction, like a serpent. She had just succeeded in curving it down into a graceful zigzag, and was going to dive in among the leaves, which she found to be nothing but the tops of the trees under which she had been wandering, when a sharp hiss made her draw back in a hurry: a large pigeon had flown into her face, and was beating her violently with its wings.",
  },
  {
    id: "alice-in-wonderland-06",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "Alice thought she might as well go back, and see how the game was going on, as she heard the Queen's voice in the distance, screaming with passion. She had already heard her sentence three of the players to be executed for having missed their turns, and she did not like the look of things at all, as the game was in such confusion that she never knew whether it was her turn or not. So she went in search of her hedgehog.",
  },
  {
    id: "alice-in-wonderland-07",
    book: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    text: "Lastly, she pictured to herself how this same little sister of hers would, in the after-time, be herself a grown woman; and how she would keep, through all her riper years, the simple and loving heart of her childhood: and how she would gather about her other little children, and make their eyes bright and eager with many a strange tale, perhaps even with the dream of Wonderland of long ago: and how she would feel with all their simple sorrows, and find a pleasure in all their simple joys, remembering her own child-life, and the happy summer days.",
  },
];
