/* =====================================================================
   RecipeHub — shared JavaScript (used by index.html, recipe.html, about.html)

   Sections
   1. Constants
   2. Ingredient normalisation (aliases, plurals)
   3. Recipe dataset (single source of truth)
   4. Small helpers (escape, formatting, toast)
   5. LocalStorage (safe read / validate / write)
   6. Theme and navigation
   7. Favourites
   8. Ratings
   9. Recipe cards
  10. Explore page: search, categories, sort, diet filter
  11. Smart Ingredient Finder
  12. Favourites / Recently viewed sections
  13. Shopping list
  14. Recipe modal + serving calculator
  15. Cooking mode
  16. Cooking timer
  17. Global events and start-up
   ===================================================================== */
'use strict';

/* ---------- 1. CONSTANTS ---------- */

const STORAGE_KEYS = {
  favourites: 'recipehub_favourites',
  ratings: 'recipehub_ratings',            // { recipeId: { sum, count } }
  userRatings: 'recipehub_user_ratings',   // { recipeId: 1..5 } (this browser only)
  recent: 'recipehub_recently_viewed',
  shopping: 'recipehub_shopping_list',
  theme: 'recipehub_theme'
};

const MAX_RECENT = 6;
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 20;
const MAX_FINDER_INGREDIENTS = 30;
const MAX_SHOPPING_ITEMS = 200;

const QUICK_INGREDIENTS = [
  'Potato', 'Tomato', 'Onion', 'Egg', 'Bread', 'Cheese', 'Rice', 'Flour', 'Milk',
  'Butter', 'Carrot', 'Cucumber', 'Garlic', 'Peas', 'Chocolate', 'Banana', 'Pasta', 'Oil'
];

const DIET_LABELS = {
  'vegetarian': 'Vegetarian',
  'vegan': 'Vegan',
  'gluten-free': 'Gluten-free',
  'dairy-free': 'Dairy-free',
  'egg-free': 'Egg-free'
};

const UNIT_PLURALS = { cup: 'cups', pinch: 'pinches' };

const FALLBACK_IMAGE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">' +
  '<rect width="600" height="400" fill="#efe3d3"/>' +
  '<text x="300" y="210" text-anchor="middle" font-family="Georgia,serif" font-size="34" fill="#b8481f">RecipeHub</text>' +
  '</svg>'
);

const HEART_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
  '<path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 2.8 4.5 6.4 4.5c2 0 3.7 1.1 4.6 2.7h2c.9-1.6 2.6-2.7 4.6-2.7 3.6 0 5.5 3.7 4 7.2C19.5 16.4 12 21 12 21z" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

/* ---------- 2. INGREDIENT NORMALISATION ---------- */
/* Turns "Potatoes", "Maida", "All-purpose flour", "Yogurt" ... into a common form
   so user input can be compared with the ingredient lists of recipes. */

// Whole phrases that mean the same thing (written in lower case, no hyphens).
const PHRASE_ALIASES = {
  'all purpose flour': 'flour',
  'plain flour': 'flour',
  'refined flour': 'flour',
  'maida': 'flour',
  'cooked rice': 'rice',
  'steamed rice': 'rice',
  'boiled rice': 'rice',
  'capsicum': 'bell pepper',
  'curd': 'yoghurt',
  'dahi': 'yoghurt',
  'yogurt': 'yoghurt',
  'green peas': 'peas',
  'aloo': 'potato',
  'tamatar': 'tomato',
  'pyaz': 'onion'
};
const PHRASE_LIST = Object.entries(PHRASE_ALIASES).sort((a, b) => b[0].length - a[0].length);

// Single words that mean the same thing (applied after plurals are removed).
const TOKEN_ALIASES = { pea: 'peas' };

// Descriptive words that do not change which ingredient it is.
const IGNORED_WORDS = new Set([
  'fresh', 'chopped', 'grated', 'sliced', 'large', 'small', 'medium', 'ripe', 'dried',
  'frozen', 'warm', 'ground', 'boiled', 'finely', 'diced', 'of', 'and', 'the', 'a', 'mixed'
]);

/** Very small plural remover: "potatoes" -> "potato", "berries" -> "berry". */
function singularize(word) {
  if (word === 'peas' || word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('ss') || word.endsWith('us')) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Returns the list of normalised words for a piece of text. */
function normalizeTokens(text) {
  let s = String(text).toLowerCase()
    .replace(/[-_/]/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  PHRASE_LIST.forEach(([phrase, replacement]) => {
    s = s.replace(new RegExp('\\b' + phrase + '\\b', 'g'), replacement);
  });
  return s.split(' ')
    .filter(Boolean)
    .map(singularize)
    .map(word => TOKEN_ALIASES[word] || word)
    .filter(word => !IGNORED_WORDS.has(word));
}

function normalizeKey(text) {
  return normalizeTokens(text).join(' ');
}

/** True when every word the user typed appears in the recipe ingredient's words. */
function tokensContain(ingredientTokens, selectedTokens) {
  return selectedTokens.length > 0 && selectedTokens.every(t => ingredientTokens.includes(t));
}

/* ---------- 3. RECIPE DATASET ---------- */

const unsplash = photoId =>
  'https://images.unsplash.com/' + photoId + '?auto=format&fit=crop&w=900&q=70';

/** Builds one ingredient. qty is a number; unit is '' for countable items.
    plural is shown when the scaled quantity is more than 1.
    staple: true marks salt/pepper/water, which the Ingredient Finder assumes you have. */
function ing(name, qty, unit, options) {
  const extra = options || {};
  return { name, qty, unit: unit || '', plural: extra.plural || '', staple: Boolean(extra.staple) };
}

const RECIPES = [
  {
    id: 'creamy-garden-pasta',
    name: 'Creamy Garden Pasta',
    category: 'Lunch',
    cuisine: 'Italian',
    description: 'Silky penne tossed in a garlicky cream sauce with sweet peas and tender carrots.',
    image: unsplash('photo-1621996346565-e3dbc646d9a9'),
    imageAlt: 'A plate of creamy penne pasta with peas and carrots',
    prep: 10, cook: 20, difficulty: 'Easy', servings: 4,
    diet: ['vegetarian'],
    ingredients: [
      ing('Penne pasta', 250, 'g'),
      ing('Butter', 2, 'tbsp'),
      ing('Garlic clove', 3, '', { plural: 'Garlic cloves' }),
      ing('Carrot', 1, '', { plural: 'Carrots' }),
      ing('Green peas', 100, 'g'),
      ing('Fresh cream', 150, 'ml'),
      ing('Grated cheese', 50, 'g'),
      ing('Salt', 1, 'tsp', { staple: true }),
      ing('Black pepper', 0.5, 'tsp', { staple: true }),
      ing('Water for boiling', 1500, 'ml', { staple: true })
    ],
    steps: [
      'Bring the water to a boil with a teaspoon of salt and cook the pasta until al dente. Drain, keeping a cup of the pasta water.',
      'Peel and finely dice the carrots. Mince the garlic.',
      'Melt the butter in a large pan over medium heat. Add the garlic and cook for 30 seconds until fragrant.',
      'Add the carrots and peas and cook for 4 to 5 minutes until just tender.',
      'Pour in the cream, add pepper and simmer gently for 3 minutes.',
      'Stir in the cooked pasta and the cheese, adding splashes of pasta water until the sauce coats the pasta.',
      'Taste, adjust the seasoning and serve hot.'
    ]
  },
  {
    id: 'fresh-rainbow-bowl',
    name: 'Fresh Rainbow Bowl',
    category: 'Lunch',
    cuisine: 'Mediterranean',
    description: 'A colourful grain bowl with crunchy vegetables, chickpeas and a bright lemon dressing.',
    image: unsplash('photo-1512621776951-a57141f2eefd'),
    imageAlt: 'A bowl of rice with colourful raw vegetables and chickpeas',
    prep: 15, cook: 0, difficulty: 'Easy', servings: 2,
    diet: ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'egg-free'],
    ingredients: [
      ing('Cooked rice', 2, 'cup'),
      ing('Carrot', 1, '', { plural: 'Carrots' }),
      ing('Cucumber', 1, '', { plural: 'Cucumbers' }),
      ing('Cherry tomato', 10, '', { plural: 'Cherry tomatoes' }),
      ing('Red cabbage', 1, 'cup'),
      ing('Cooked chickpeas', 1, 'cup'),
      ing('Olive oil', 2, 'tbsp'),
      ing('Lemon juice', 2, 'tbsp'),
      ing('Salt', 0.5, 'tsp', { staple: true })
    ],
    steps: [
      'Grate the carrot and shred the red cabbage finely.',
      'Slice the cucumber into half moons and halve the cherry tomatoes.',
      'Whisk the olive oil, lemon juice and salt in a small bowl to make the dressing.',
      'Divide the rice between two bowls and arrange the vegetables and chickpeas in sections on top.',
      'Drizzle with the dressing and serve straight away.'
    ]
  },
  {
    id: 'classic-homemade-pizza',
    name: 'Classic Homemade Pizza',
    category: 'Dinner',
    cuisine: 'Italian',
    description: 'A chewy hand-stretched crust with tangy tomato sauce, melting mozzarella and fresh vegetables. Preparation time includes dough rising.',
    image: unsplash('photo-1513104890138-7c749659a591'),
    imageAlt: 'A freshly baked pizza topped with cheese and vegetables',
    prep: 70, cook: 15, difficulty: 'Medium', servings: 4,
    diet: ['vegetarian'],
    ingredients: [
      ing('Flour', 300, 'g'),
      ing('Instant yeast', 1, 'tsp'),
      ing('Sugar', 1, 'tsp'),
      ing('Warm water', 200, 'ml', { staple: true }),
      ing('Olive oil', 2, 'tbsp'),
      ing('Tomato sauce', 150, 'ml'),
      ing('Mozzarella cheese', 200, 'g'),
      ing('Bell pepper', 1, '', { plural: 'Bell peppers' }),
      ing('Onion', 1, '', { plural: 'Onions' }),
      ing('Dried oregano', 1, 'tsp'),
      ing('Salt', 1, 'tsp', { staple: true })
    ],
    steps: [
      'Mix the flour, yeast, sugar and salt in a large bowl. Add the warm water and half the olive oil and mix into a dough.',
      'Knead for 8 to 10 minutes until smooth and elastic.',
      'Cover and let the dough rise in a warm place for about 1 hour, until doubled.',
      'Heat the oven to its highest setting, around 250°C (480°F).',
      'Slice the bell pepper and onion thinly. Stretch the dough into a round on a lightly oiled tray.',
      'Spread the tomato sauce over the base, scatter the mozzarella and vegetables, and sprinkle with oregano.',
      'Bake for 12 to 15 minutes until the crust is golden and the cheese is bubbling.',
      'Rest for 2 minutes, slice and serve.'
    ]
  },
  {
    id: 'masala-dosa',
    name: 'Masala Dosa',
    category: 'Breakfast',
    cuisine: 'South Indian',
    description: 'Crisp, golden rice-and-lentil crepes filled with spiced potato masala. The batter needs to be soaked and fermented overnight.',
    image: unsplash('photo-1668236543090-82eba5ee5976'),
    imageAlt: 'A crisp golden dosa folded around potato filling',
    prep: 45, cook: 30, difficulty: 'Hard', servings: 4,
    diet: ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'egg-free'],
    ingredients: [
      ing('Parboiled rice', 2, 'cup'),
      ing('Urad dal', 0.5, 'cup'),
      ing('Fenugreek seed', 0.5, 'tsp'),
      ing('Potato', 4, '', { plural: 'Potatoes' }),
      ing('Onion', 2, '', { plural: 'Onions' }),
      ing('Mustard seed', 1, 'tsp'),
      ing('Turmeric powder', 0.5, 'tsp'),
      ing('Green chilli', 2, '', { plural: 'Green chillies' }),
      ing('Oil', 3, 'tbsp'),
      ing('Salt', 1.5, 'tsp', { staple: true }),
      ing('Water', 500, 'ml', { staple: true })
    ],
    steps: [
      'Rinse the rice, urad dal and fenugreek seeds, then soak them in water for 6 hours.',
      'Drain and grind to a smooth batter with a little water. Add salt, cover and ferment overnight (8 to 10 hours) until bubbly.',
      'Boil the potatoes until soft, peel and roughly mash them.',
      'Heat 2 tablespoons of oil, crackle the mustard seeds, then add the sliced onions and chopped green chillies and cook until soft.',
      'Add the turmeric, salt and mashed potatoes and mix well. Set the masala aside.',
      'Heat a flat pan and grease it lightly. Pour a ladle of batter and spread it thin in a circle.',
      'Drizzle a little oil around the edges and cook until the underside is deep golden and crisp.',
      'Spoon the potato masala in the centre, fold the dosa over and serve hot.'
    ]
  },
  {
    id: 'fluffy-pancakes',
    name: 'Fluffy Pancakes',
    category: 'Breakfast',
    cuisine: 'American',
    description: 'Tall, soft pancakes with golden edges — the perfect lazy weekend breakfast.',
    image: unsplash('photo-1567620905732-2d1ec7ab7445'),
    imageAlt: 'A stack of fluffy pancakes',
    prep: 10, cook: 15, difficulty: 'Easy', servings: 4,
    diet: ['vegetarian'],
    ingredients: [
      ing('Flour', 200, 'g'),
      ing('Baking powder', 2, 'tsp'),
      ing('Sugar', 2, 'tbsp'),
      ing('Salt', 1, 'pinch', { staple: true }),
      ing('Milk', 250, 'ml'),
      ing('Egg', 1, '', { plural: 'Eggs' }),
      ing('Butter', 3, 'tbsp')
    ],
    steps: [
      'Melt the butter and let it cool slightly.',
      'Whisk the flour, baking powder, sugar and salt together in a large bowl.',
      'In a jug, beat the egg with the milk and the melted butter.',
      'Pour the wet mixture into the dry ingredients and stir until just combined. A few lumps are fine.',
      'Rest the batter for 5 minutes.',
      'Heat a lightly greased pan over medium heat and pour in a small ladle of batter for each pancake.',
      'Cook until bubbles form on top, then flip and cook for another minute until golden.',
      'Serve warm with your favourite toppings.'
    ]
  },
  {
    id: 'chocolate-brownies',
    name: 'Chocolate Brownies',
    category: 'Desserts',
    cuisine: 'American',
    description: 'Fudgy, rich brownies with a crackly top and a deep chocolate flavour.',
    image: unsplash('photo-1606313564200-e75d5e30476c'),
    imageAlt: 'Squares of dark chocolate brownies on a board',
    prep: 15, cook: 25, difficulty: 'Easy', servings: 9,
    diet: ['vegetarian'],
    ingredients: [
      ing('Dark chocolate', 150, 'g'),
      ing('Butter', 120, 'g'),
      ing('Sugar', 150, 'g'),
      ing('Egg', 2, '', { plural: 'Eggs' }),
      ing('Flour', 80, 'g'),
      ing('Cocoa powder', 2, 'tbsp'),
      ing('Salt', 1, 'pinch', { staple: true })
    ],
    steps: [
      'Heat the oven to 180°C (350°F) and line a 20 cm square tin with baking paper.',
      'Melt the chocolate and butter together in a bowl set over simmering water, stirring until smooth. Let it cool for 5 minutes.',
      'Whisk in the sugar, then the eggs one at a time, until glossy.',
      'Sift in the flour, cocoa powder and salt and fold gently until no streaks remain.',
      'Pour the batter into the tin and level the top.',
      'Bake for 22 to 25 minutes. The top should be set and a skewer should come out with moist crumbs.',
      'Cool completely in the tin before cutting into squares.'
    ]
  },
  {
    id: 'veggie-sandwich',
    name: 'Veggie Sandwich',
    category: 'Snacks',
    cuisine: 'Continental',
    description: 'A crunchy toasted sandwich layered with fresh vegetables and melty cheese.',
    image: unsplash('photo-1528735602780-2552fd46c7af'),
    imageAlt: 'A toasted sandwich filled with vegetables and cheese',
    prep: 10, cook: 5, difficulty: 'Easy', servings: 2,
    diet: ['vegetarian'],
    ingredients: [
      ing('Bread slice', 4, '', { plural: 'Bread slices' }),
      ing('Butter', 2, 'tbsp'),
      ing('Cucumber', 1, '', { plural: 'Cucumbers' }),
      ing('Tomato', 1, '', { plural: 'Tomatoes' }),
      ing('Onion', 1, '', { plural: 'Onions' }),
      ing('Cheese slice', 2, '', { plural: 'Cheese slices' }),
      ing('Black pepper', 0.25, 'tsp', { staple: true }),
      ing('Salt', 1, 'pinch', { staple: true })
    ],
    steps: [
      'Slice the cucumber, tomato and onion into thin rounds.',
      'Butter one side of each bread slice.',
      'On two slices, layer the cucumber, tomato, onion and cheese. Season with salt and pepper.',
      'Top with the remaining bread, buttered side out.',
      'Toast in a pan or sandwich maker for 3 to 4 minutes, turning once, until golden and crisp.',
      'Cut diagonally and serve warm.'
    ]
  },
  {
    id: 'creamy-tomato-soup',
    name: 'Creamy Tomato Soup',
    category: 'Dinner',
    cuisine: 'Continental',
    description: 'A velvety, comforting soup made with ripe tomatoes, garlic and a swirl of cream.',
    image: unsplash('photo-1547592166-23ac45744acd'),
    imageAlt: 'A bowl of creamy tomato soup with basil',
    prep: 10, cook: 30, difficulty: 'Easy', servings: 3,
    diet: ['vegetarian'],
    ingredients: [
      ing('Tomato', 6, '', { plural: 'Tomatoes' }),
      ing('Onion', 1, '', { plural: 'Onions' }),
      ing('Garlic clove', 2, '', { plural: 'Garlic cloves' }),
      ing('Butter', 1, 'tbsp'),
      ing('Vegetable stock', 500, 'ml'),
      ing('Fresh cream', 3, 'tbsp'),
      ing('Sugar', 1, 'tsp'),
      ing('Basil leaf', 6, '', { plural: 'Basil leaves' }),
      ing('Salt', 1, 'tsp', { staple: true }),
      ing('Black pepper', 0.5, 'tsp', { staple: true })
    ],
    steps: [
      'Roughly chop the tomatoes and onion and mince the garlic.',
      'Melt the butter in a pot and soften the onion and garlic for 4 minutes.',
      'Add the tomatoes, sugar and a pinch of salt and cook for 8 minutes until they break down.',
      'Pour in the vegetable stock and simmer for 15 minutes.',
      'Blend until completely smooth, then strain if you want a silkier texture.',
      'Return to the pot, stir in the cream and season with salt and pepper.',
      'Serve hot, topped with torn basil leaves.'
    ]
  },
  {
    id: 'berry-smoothie',
    name: 'Berry Smoothie',
    category: 'Breakfast',
    cuisine: 'International',
    description: 'A thick, chilled blend of berries, banana and yoghurt. Ready in five minutes.',
    image: unsplash('photo-1505252585461-04db1eb84625'),
    imageAlt: 'A glass of pink berry smoothie',
    prep: 5, cook: 0, difficulty: 'Easy', servings: 2,
    diet: ['vegetarian', 'gluten-free', 'egg-free'],
    ingredients: [
      ing('Mixed berries', 150, 'g'),
      ing('Banana', 1, '', { plural: 'Bananas' }),
      ing('Yogurt', 150, 'g'),
      ing('Milk', 100, 'ml'),
      ing('Honey', 1, 'tbsp')
    ],
    steps: [
      'Peel and slice the banana.',
      'Add the berries, banana, yoghurt, milk and honey to a blender.',
      'Blend on high for 45 to 60 seconds until completely smooth.',
      'Taste and add more honey if you like it sweeter, then pour into glasses and serve cold.'
    ]
  },
  {
    id: 'vegetable-fried-rice',
    name: 'Vegetable Fried Rice',
    category: 'Lunch',
    cuisine: 'Chinese',
    description: 'Quick wok-tossed rice with crisp vegetables, garlic and soy sauce — ideal for leftover rice.',
    image: unsplash('photo-1603133872878-684f208fb84b'),
    imageAlt: 'A bowl of vegetable fried rice with peas and carrots',
    prep: 10, cook: 15, difficulty: 'Easy', servings: 3,
    diet: ['vegetarian', 'vegan', 'dairy-free', 'egg-free'],
    ingredients: [
      ing('Cooked rice', 3, 'cup'),
      ing('Carrot', 1, '', { plural: 'Carrots' }),
      ing('Green peas', 0.5, 'cup'),
      ing('Onion', 1, '', { plural: 'Onions' }),
      ing('Garlic clove', 3, '', { plural: 'Garlic cloves' }),
      ing('Spring onion', 2, '', { plural: 'Spring onions' }),
      ing('Soy sauce', 2, 'tbsp'),
      ing('Oil', 2, 'tbsp'),
      ing('Black pepper', 0.5, 'tsp', { staple: true }),
      ing('Salt', 0.5, 'tsp', { staple: true })
    ],
    steps: [
      'Dice the carrot and onion, mince the garlic and slice the spring onions.',
      'Heat the oil in a wok over high heat. Fry the garlic for 15 seconds.',
      'Add the onion, carrot and peas and stir-fry for 3 to 4 minutes until crisp-tender.',
      'Add the cooked rice, breaking up any lumps, and toss for 3 minutes.',
      'Add the soy sauce, pepper and salt and toss until evenly coated.',
      'Finish with the spring onions and serve immediately.'
    ]
  },
  {
    id: 'chocolate-cake',
    name: 'Chocolate Cake',
    category: 'Desserts',
    cuisine: 'International',
    description: 'A moist, tender chocolate sponge finished with a glossy chocolate ganache.',
    image: unsplash('photo-1578985545062-69928b1d9587'),
    imageAlt: 'A chocolate cake with a slice cut out',
    prep: 20, cook: 35, difficulty: 'Medium', servings: 8,
    diet: ['vegetarian'],
    ingredients: [
      ing('Flour', 200, 'g'),
      ing('Sugar', 200, 'g'),
      ing('Cocoa powder', 50, 'g'),
      ing('Baking powder', 2, 'tsp'),
      ing('Egg', 2, '', { plural: 'Eggs' }),
      ing('Milk', 200, 'ml'),
      ing('Butter', 100, 'g'),
      ing('Vanilla extract', 1, 'tsp'),
      ing('Dark chocolate', 100, 'g'),
      ing('Fresh cream', 100, 'ml')
    ],
    steps: [
      'Heat the oven to 175°C (350°F). Grease and line a 20 cm round cake tin.',
      'Melt the butter and let it cool slightly.',
      'Sift the flour, cocoa and baking powder into a large bowl and stir in the sugar.',
      'Whisk the eggs, milk, melted butter and vanilla together, then pour into the dry mixture and stir until smooth.',
      'Pour into the tin and bake for 30 to 35 minutes, until a skewer comes out clean.',
      'Cool in the tin for 10 minutes, then turn out onto a rack.',
      'For the ganache, heat the cream until steaming, pour over the chopped chocolate, wait a minute and stir until glossy.',
      'Spread the ganache over the cooled cake and let it set before slicing.'
    ]
  },
  {
    id: 'crispy-samosa',
    name: 'Crispy Samosa',
    category: 'Snacks',
    cuisine: 'Indian',
    description: 'Flaky, golden pastry parcels stuffed with spiced potatoes and peas.',
    image: unsplash('photo-1601050690597-df0568f70950'),
    imageAlt: 'Golden fried samosas on a plate',
    prep: 40, cook: 25, difficulty: 'Medium', servings: 6,
    diet: ['vegetarian', 'vegan', 'dairy-free', 'egg-free'],
    ingredients: [
      ing('All-purpose flour', 250, 'g'),
      ing('Oil', 4, 'tbsp'),
      ing('Potato', 4, '', { plural: 'Potatoes' }),
      ing('Green peas', 0.5, 'cup'),
      ing('Cumin seed', 1, 'tsp'),
      ing('Coriander powder', 1, 'tsp'),
      ing('Garam masala', 1, 'tsp'),
      ing('Green chilli', 2, '', { plural: 'Green chillies' }),
      ing('Oil for deep frying', 500, 'ml'),
      ing('Salt', 1.5, 'tsp', { staple: true }),
      ing('Water', 100, 'ml', { staple: true })
    ],
    steps: [
      'Mix the flour, 3 tablespoons of oil and half the salt. Add water gradually to make a firm dough, then rest it for 30 minutes.',
      'Boil the potatoes until tender, peel and coarsely mash them.',
      'Heat the remaining oil, crackle the cumin seeds, then add the chopped chilli, peas, coriander powder, garam masala and remaining salt.',
      'Add the potatoes, mix well and let the filling cool completely.',
      'Divide the dough into balls and roll each into an oval. Cut in half to make two semicircles.',
      'Shape each half into a cone, fill with potato masala and seal the edges with a little water.',
      'Heat the frying oil over medium-low heat and fry the samosas in batches for 8 to 10 minutes until deep golden.',
      'Drain on paper towels and serve hot.'
    ]
  }
];

const recipeById = new Map();

/** Adds helper fields used by search and the Ingredient Finder. */
function prepareRecipes() {
  RECIPES.forEach((recipe, index) => {
    recipe.order = index;
    recipe.totalTime = recipe.prep + recipe.cook;
    recipe.ingredients.forEach(item => {
      item.tokens = normalizeTokens(item.name);
    });
    recipe.searchText = [
      recipe.name, recipe.category, recipe.cuisine, recipe.description,
      recipe.ingredients.map(i => i.name + ' ' + i.tokens.join(' ')).join(' ')
    ].join(' ').toLowerCase();
    recipeById.set(recipe.id, recipe);
  });
}
prepareRecipes();

/* ---------- 4. SMALL HELPERS ---------- */

const $ = id => document.getElementById(id);

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatMinutes(total) {
  if (total < 60) return total + ' min';
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes ? hours + ' hr ' + minutes + ' min' : hours + ' hr';
}

/** Formats a number using common fractions: 1.5 -> "1½", 0.333 -> "⅓". */
function formatFraction(value) {
  const fractions = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];
  let whole = Math.floor(value + 1e-9);
  const rest = value - whole;
  let best = fractions[0];
  fractions.forEach(f => {
    if (Math.abs(rest - f[0]) < Math.abs(rest - best[0])) best = f;
  });
  if (Math.abs(rest - best[0]) > 0.04) {
    return String(Number(value.toFixed(1)));
  }
  if (best[0] === 1) whole += 1;
  if (!best[1]) return String(whole);
  return whole > 0 ? whole + ' ' + best[1] : best[1];
}

/** Scaled amount as text, e.g. "375 g", "1½ cups" or "3" for countable items. */
function formatAmount(ingredient, value) {
  const unit = ingredient.unit;
  if (!unit) return formatFraction(value);
  if (unit === 'g' || unit === 'ml') return Math.round(value) + ' ' + unit;
  const unitText = value > 1.0001 && UNIT_PLURALS[unit] ? UNIT_PLURALS[unit] : unit;
  return formatFraction(value) + ' ' + unitText;
}

function displayName(ingredient, value) {
  return !ingredient.unit && value > 1.0001 && ingredient.plural ? ingredient.plural : ingredient.name;
}

let toastTimer = null;
/** Small message at the bottom of the screen (works on every page). */
function showToast(message) {
  let toast = $('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

/* ---------- 5. LOCALSTORAGE ---------- */

function readStorage(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch (error) {
    console.warn('RecipeHub: could not read "' + key + '" from storage; using defaults.', error);
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('RecipeHub: could not save "' + key + '" to storage.', error);
  }
}

function sanitizeIdList(value, limit) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  value.forEach(id => {
    if (typeof id === 'string' && recipeById.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  });
  return limit ? result.slice(0, limit) : result;
}

function sanitizeRatings(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  Object.keys(value).forEach(id => {
    const entry = value[id];
    if (!recipeById.has(id) || !entry) return;
    const validCount = Number.isInteger(entry.count) && entry.count > 0;
    if (validCount && typeof entry.sum === 'number' && entry.sum >= entry.count && entry.sum <= entry.count * 5) {
      result[id] = { sum: entry.sum, count: entry.count };
    }
  });
  return result;
}

function sanitizeUserRatings(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  Object.keys(value).forEach(id => {
    const rating = value[id];
    if (recipeById.has(id) && Number.isInteger(rating) && rating >= 1 && rating <= 5) result[id] = rating;
  });
  return result;
}

function sanitizeShopping(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  value.forEach(item => {
    if (!item || typeof item.key !== 'string' || typeof item.name !== 'string' || seen.has(item.key)) return;
    seen.add(item.key);
    result.push({
      key: item.key,
      name: item.name.slice(0, 80),
      amount: typeof item.amount === 'string' ? item.amount.slice(0, 30) : '',
      checked: item.checked === true
    });
  });
  return result.slice(0, MAX_SHOPPING_ITEMS);
}

/** All saved data lives here while the page is open. */
const store = {
  favourites: [],
  ratings: {},
  userRatings: {},
  recent: [],
  shopping: []
};

function loadStore() {
  store.favourites = sanitizeIdList(readStorage(STORAGE_KEYS.favourites));
  store.ratings = sanitizeRatings(readStorage(STORAGE_KEYS.ratings));
  store.userRatings = sanitizeUserRatings(readStorage(STORAGE_KEYS.userRatings));
  Object.keys(store.userRatings).forEach(id => {
    if (!store.ratings[id]) delete store.userRatings[id];   // a personal rating needs a matching total
  });
  store.recent = sanitizeIdList(readStorage(STORAGE_KEYS.recent), MAX_RECENT);
  store.shopping = sanitizeShopping(readStorage(STORAGE_KEYS.shopping));
}

/** Screen state that is not saved. */
const ui = {
  category: 'All Recipes',
  query: '',
  sort: 'default',
  diet: '',
  modalRecipe: null,
  servings: 1,
  lastFocus: null,
  finder: [],            // [{ label, key, tokens }]
  finderActive: false,
  cooking: { recipe: null, index: 0, opener: null }
};

/* ---------- 6. THEME AND NAVIGATION ---------- */

function getInitialTheme() {
  const saved = readStorage(STORAGE_KEYS.theme);
  if (saved === 'dark' || saved === 'light') return saved;
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const button = $('theme-toggle');
  if (!button) return;
  const isDark = theme === 'dark';
  button.setAttribute('aria-pressed', String(isDark));
  button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  const icon = button.querySelector('.theme-icon');
  if (icon) icon.textContent = isDark ? '☀' : '☾';
}

function initTheme() {
  applyTheme(document.documentElement.getAttribute('data-theme') || getInitialTheme());
  const button = $('theme-toggle');
  if (!button) return;
  button.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    writeStorage(STORAGE_KEYS.theme, next);
  });
}

function closeMobileMenu() {
  const nav = $('primary-nav');
  const toggle = $('menu-toggle');
  if (!nav || !toggle) return;
  nav.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
}

function initNavigation() {
  const nav = $('primary-nav');
  const toggle = $('menu-toggle');
  if (!nav || !toggle) return;

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  // Close the menu after any link is chosen.
  nav.addEventListener('click', event => {
    if (event.target.closest('a')) closeMobileMenu();
  });
  document.addEventListener('click', event => {
    if (nav.classList.contains('open') && !event.target.closest('.nav-wrap')) closeMobileMenu();
  });

  // Mark the link of the page we are on.
  const file = window.location.pathname.split('/').pop() || 'index.html';
  nav.querySelectorAll('a[href]').forEach(link => {
    if (link.getAttribute('href') === file) link.setAttribute('aria-current', 'page');
  });
}

/* ---------- 7. FAVOURITES ---------- */

function isFavourite(id) {
  return store.favourites.includes(id);
}

function toggleFavourite(id) {
  const recipe = recipeById.get(id);
  if (!recipe) return;
  const index = store.favourites.indexOf(id);
  if (index >= 0) {
    store.favourites.splice(index, 1);
    showToast('Removed ' + recipe.name + ' from favourites');
  } else {
    store.favourites.push(id);
    showToast('Saved ' + recipe.name + ' to favourites');
  }
  writeStorage(STORAGE_KEYS.favourites, store.favourites);
  updateFavouriteUI();
  renderFavourites();
}

/** Keeps every heart button and the navigation counter in sync. */
function updateFavouriteUI() {
  document.querySelectorAll('.fav-btn').forEach(button => {
    const recipe = recipeById.get(button.dataset.recipeId);
    if (!recipe) return;
    const saved = isFavourite(recipe.id);
    button.classList.toggle('active', saved);
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', (saved ? 'Remove ' : 'Add ') + recipe.name + (saved ? ' from' : ' to') + ' favourites');
    const label = button.querySelector('.fav-label');
    if (label) label.textContent = saved ? 'Saved to favourites' : 'Save to favourites';
  });
  document.querySelectorAll('[data-fav-count]').forEach(el => {
    el.textContent = String(store.favourites.length);
  });
}

/* ---------- 8. RATINGS ---------- */

function getRatingInfo(id) {
  const entry = store.ratings[id];
  return {
    count: entry ? entry.count : 0,
    average: entry ? entry.sum / entry.count : 0,
    user: store.userRatings[id] || 0
  };
}

function ratingInnerHTML(id) {
  const recipe = recipeById.get(id);
  const info = getRatingInfo(id);
  const filled = info.user || Math.round(info.average);
  let stars = '';
  for (let value = 1; value <= 5; value++) {
    stars += '<button type="button" class="star' + (value <= filled ? ' filled' : '') + '" data-value="' + value + '"' +
      ' aria-pressed="' + (info.user === value) + '"' +
      ' aria-label="Rate ' + escapeHTML(recipe.name) + ' ' + value + ' out of 5 stars">★</button>';
  }
  let text = '<span class="rating-text">No ratings yet</span>';
  if (info.count > 0) {
    text = '<span class="rating-text"><strong>' + info.average.toFixed(1) + '</strong> (' + info.count + ' ' +
      (info.count === 1 ? 'rating' : 'ratings') + ')' + (info.user ? ' · you gave ' + info.user : '') + '</span>';
  }
  return '<div class="stars' + (info.user ? ' user-rated' : '') + '" role="group" aria-label="Rating for ' +
    escapeHTML(recipe.name) + '">' + stars + '</div>' + text;
}

/** Re-draws every visible copy of one recipe's rating. */
function refreshRatings(id) {
  const active = document.activeElement;
  const activeBox = active && active.classList && active.classList.contains('star') ? active.closest('.rating') : null;
  const activeValue = activeBox ? active.dataset.value : null;

  document.querySelectorAll('.rating[data-recipe-id="' + id + '"]').forEach(box => {
    box.innerHTML = ratingInnerHTML(id);
    if (box === activeBox) {
      const star = box.querySelector('.star[data-value="' + activeValue + '"]');
      if (star) star.focus();
    }
  });
}

function setUserRating(id, value) {
  const recipe = recipeById.get(id);
  if (!recipe || !Number.isInteger(value) || value < 1 || value > 5) return;
  const entry = store.ratings[id] || { sum: 0, count: 0 };
  const previous = store.userRatings[id];
  if (previous) {
    entry.sum += value - previous;     // changing a rating does not add another vote
  } else {
    entry.sum += value;
    entry.count += 1;
  }
  store.ratings[id] = entry;
  store.userRatings[id] = value;
  writeStorage(STORAGE_KEYS.ratings, store.ratings);
  writeStorage(STORAGE_KEYS.userRatings, store.userRatings);
  refreshRatings(id);
  showToast(previous ? 'Rating updated. Thank you!' : 'Thanks for rating ' + recipe.name + '!');
}

/* ---------- 9. RECIPE CARDS ---------- */

function recipeCardHTML(recipe, extraHTML) {
  const saved = isFavourite(recipe.id);
  const name = escapeHTML(recipe.name);
  return '' +
    '<article class="recipe-card" data-recipe-id="' + recipe.id + '">' +
      '<div class="card-media">' +
        '<img src="' + recipe.image + '" alt="' + escapeHTML(recipe.imageAlt) + '" loading="lazy" width="600" height="400">' +
        '<span class="card-badge">' + escapeHTML(recipe.category) + '</span>' +
        '<button type="button" class="fav-btn' + (saved ? ' active' : '') + '" data-recipe-id="' + recipe.id + '"' +
          ' aria-pressed="' + saved + '" aria-label="' + (saved ? 'Remove ' : 'Add ') + name + (saved ? ' from' : ' to') + ' favourites">' +
          HEART_SVG + '</button>' +
      '</div>' +
      '<div class="card-body">' +
        '<p class="card-cuisine">' + escapeHTML(recipe.cuisine) + '</p>' +
        '<h3 class="card-title"><button type="button" class="card-open" data-open-recipe="' + recipe.id + '">' + name + '</button></h3>' +
        '<ul class="card-meta">' +
          '<li>' + escapeHTML(recipe.difficulty) + '</li>' +
          '<li>' + formatMinutes(recipe.totalTime) + ' total</li>' +
        '</ul>' +
        '<div class="rating" data-recipe-id="' + recipe.id + '">' + ratingInnerHTML(recipe.id) + '</div>' +
        (extraHTML || '') +
      '</div>' +
    '</article>';
}

function renderCards(container, recipes) {
  if (!container) return;
  container.innerHTML = recipes.map(recipe => recipeCardHTML(recipe)).join('');
}

/** Opens a recipe: in the modal on recipe.html, or via the Explore page from other pages. */
function openRecipe(id, opener) {
  const recipe = recipeById.get(id);
  if (!recipe) return;
  if (!$('recipe-modal')) {
    window.location.href = 'recipe.html?recipe=' + encodeURIComponent(id);
    return;
  }
  ui.modalRecipe = recipe;
  ui.servings = recipe.servings;
  ui.lastFocus = opener || document.activeElement;
  fillModal(recipe);
  $('modal-backdrop').hidden = false;
  $('modal-scroll').scrollTop = 0;
  updateScrollLock();
  $('recipe-modal').focus({ preventScroll: true });
  addRecentlyViewed(id);
}

/* ---------- 10. EXPLORE PAGE: SEARCH, CATEGORIES, SORT ---------- */

function matchesQuery(recipe, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every(word => {
    if (recipe.searchText.includes(word)) return true;
    const normalised = normalizeKey(word);            // "curd" -> "yoghurt", "potatoes" -> "potato"
    return normalised !== '' && recipe.searchText.includes(normalised);
  });
}

function getFilteredRecipes() {
  const list = RECIPES.filter(recipe =>
    (ui.category === 'All Recipes' || recipe.category === ui.category) &&
    (!ui.diet || recipe.diet.includes(ui.diet)) &&
    matchesQuery(recipe, ui.query)
  );
  if (ui.sort === 'alphabetical') {
    list.sort((a, b) => a.name.localeCompare(b.name));
  } else if (ui.sort === 'time') {
    list.sort((a, b) => a.totalTime - b.totalTime || a.order - b.order);
  } else if (ui.sort === 'rating') {
    list.sort((a, b) => {
      const ra = getRatingInfo(a.id);
      const rb = getRatingInfo(b.id);
      return rb.average - ra.average || rb.count - ra.count || a.order - b.order;
    });
  }
  return list;
}

function renderExplore() {
  const grid = $('recipe-grid');
  if (!grid) return;
  const list = getFilteredRecipes();
  renderCards(grid, list);
  grid.hidden = list.length === 0;

  const count = $('results-count');
  if (count) {
    count.textContent = 'Showing ' + list.length + ' of ' + RECIPES.length + ' recipes';
  }
  const empty = $('no-results');
  if (empty) {
    empty.hidden = list.length > 0;
    const text = $('no-results-text');
    if (text) {
      text.textContent = ui.query
        ? 'We could not find anything for “' + ui.query + '”' + (ui.category !== 'All Recipes' ? ' in ' + ui.category : '') +
          '. Try a different word, an ingredient such as “tomato”, or clear the filters.'
        : 'No recipes match the selected filters. Try another category or dietary option.';
    }
  }
  const clearButton = $('clear-search');
  if (clearButton) clearButton.hidden = ui.query === '';
}

function syncFilterControls() {
  const input = $('search-input');
  if (input) input.value = ui.query;
  const sort = $('sort-select');
  if (sort) sort.value = ui.sort;
  const diet = $('diet-filter');
  if (diet) diet.value = ui.diet;
  document.querySelectorAll('#category-filters [data-category]').forEach(button => {
    const active = button.dataset.category === ui.category;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function initExploreControls() {
  const grid = $('recipe-grid');
  if (!grid) return;

  const params = new URLSearchParams(window.location.search);
  ui.query = (params.get('q') || '').trim().slice(0, 100);

  const input = $('search-input');
  if (input) {
    input.addEventListener('input', () => {              // instant search
      ui.query = input.value.trim();
      renderExplore();
    });
  }
  const form = $('search-form');
  if (form) {
    form.addEventListener('submit', event => {            // search button / Enter key
      event.preventDefault();
      ui.query = input ? input.value.trim() : '';
      renderExplore();
    });
  }
  const clearButton = $('clear-search');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      ui.query = '';
      syncFilterControls();
      renderExplore();
      if (input) input.focus();
    });
  }
  const categories = $('category-filters');
  if (categories) {
    categories.addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      ui.category = button.dataset.category;
      syncFilterControls();
      renderExplore();
    });
  }
  const sort = $('sort-select');
  if (sort) {
    sort.addEventListener('change', () => {
      ui.sort = sort.value;
      renderExplore();
    });
  }
  const diet = $('diet-filter');
  if (diet) {
    diet.addEventListener('change', () => {
      ui.diet = diet.value;
      renderExplore();
    });
  }
  const reset = $('reset-filters');
  if (reset) {
    reset.addEventListener('click', () => {
      ui.category = 'All Recipes';
      ui.query = '';
      ui.sort = 'default';
      ui.diet = '';
      syncFilterControls();
      renderExplore();
    });
  }

  syncFilterControls();
  renderExplore();

  // Opened from another page, e.g. recipe.html?recipe=masala-dosa
  const requested = params.get('recipe');
  if (requested && recipeById.has(requested)) openRecipe(requested);
}

/* ---------- 11. SMART INGREDIENT FINDER ---------- */

function setFinderMessage(text) {
  const message = $('finder-message');
  if (message) message.textContent = text;
}

function addFinderIngredients(rawText) {
  const parts = String(rawText).split(',').map(part => part.trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (parts.length === 0) {
    setFinderMessage('Type an ingredient first, then press Add.');
    return;
  }
  const notes = [];
  parts.forEach(part => {
    const label = part.slice(0, 40);
    const tokens = normalizeTokens(label);
    const key = tokens.join(' ');
    if (!key) {
      notes.push('“' + label + '” is not a recognisable ingredient.');
    } else if (ui.finder.some(item => item.key === key)) {
      notes.push('“' + label + '” is already in your list.');
    } else if (ui.finder.length >= MAX_FINDER_INGREDIENTS) {
      notes.push('You can add up to ' + MAX_FINDER_INGREDIENTS + ' ingredients.');
    } else {
      ui.finder.push({ label: capitalise(label), key, tokens });
    }
  });
  setFinderMessage(notes.join(' '));
  refreshFinder();
}

function removeFinderIngredient(key) {
  ui.finder = ui.finder.filter(item => item.key !== key);
  setFinderMessage('');
  refreshFinder();
}

function renderFinderChips() {
  const list = $('selected-ingredients');
  if (list) {
    list.innerHTML = ui.finder.length === 0
      ? '<li class="chips-empty">No ingredients selected yet. Add a few from the suggestions or type your own.</li>'
      : ui.finder.map(item =>
          '<li class="chip"><span>' + escapeHTML(item.label) + '</span>' +
          '<button type="button" class="chip-remove" data-remove-ingredient="' + escapeHTML(item.key) + '"' +
          ' aria-label="Remove ' + escapeHTML(item.label) + '">×</button></li>').join('');
  }
  document.querySelectorAll('#quick-add .quick-chip').forEach(button => {
    const selected = ui.finder.some(item => item.key === normalizeKey(button.dataset.ingredient));
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const clear = $('clear-ingredients');
  if (clear) clear.disabled = ui.finder.length === 0;
}

/** Compares the selected ingredients with every recipe. */
function computeMatches(selected, strict) {
  const results = [];
  RECIPES.forEach(recipe => {
    const required = recipe.ingredients.filter(item => !item.staple);
    const matched = [];
    const missing = [];
    required.forEach(item => {
      const have = selected.some(sel => tokensContain(item.tokens, sel.tokens));
      (have ? matched : missing).push(item);
    });
    if (matched.length === 0) return;
    if (strict && missing.length > 0) return;       // strict: every required ingredient must be selected
    results.push({
      recipe, matched, missing,
      total: required.length,
      percent: Math.round((matched.length / required.length) * 100)
    });
  });
  results.sort((a, b) =>
    b.percent - a.percent || b.matched.length - a.matched.length || a.recipe.order - b.recipe.order);
  return results;
}

function finderExtraHTML(result, strict) {
  const complete = result.missing.length === 0;
  let html = '<div class="match-info">' +
    '<progress class="match-progress" max="100" value="' + result.percent + '" aria-label="' + result.percent + ' percent match"></progress>' +
    '<p class="match-text"><strong>' + result.percent + '% match</strong> · ' + result.matched.length + ' of ' + result.total + ' ingredients</p>';
  if (complete) {
    html += '<p class="match-ok">You have everything you need.</p>';
  } else if (!strict) {
    html += '<p class="match-missing"><strong>Missing:</strong> ' +
      result.missing.map(item => escapeHTML(item.name)).join(', ') + '</p>';
  }
  return html + '</div>';
}

function renderFinderResults() {
  const section = $('finder-results-section');
  if (!section) return;
  const strictBox = $('strict-match');
  const strict = strictBox ? strictBox.checked : false;
  const results = computeMatches(ui.finder, strict);

  section.hidden = false;
  const summary = $('finder-summary');
  const grid = $('finder-results');
  const empty = $('finder-empty');

  if (summary) {
    summary.textContent = results.length === 0
      ? 'No matching recipes'
      : results.length + (results.length === 1 ? ' recipe matches' : ' recipes match') + ' your ingredients' +
        (strict ? ' (strict matching)' : ', best match first');
  }
  if (grid) {
    grid.innerHTML = results.map(result => recipeCardHTML(result.recipe, finderExtraHTML(result, strict))).join('');
    grid.hidden = results.length === 0;
  }
  if (empty) empty.hidden = results.length > 0;
}

function hideFinderResults() {
  ui.finderActive = false;
  const section = $('finder-results-section');
  if (section) section.hidden = true;
}

/** Called whenever the selected ingredients change. */
function refreshFinder() {
  renderFinderChips();
  if (!ui.finderActive) return;
  if (ui.finder.length === 0) {
    hideFinderResults();
  } else {
    renderFinderResults();
  }
}

function initIngredientFinder() {
  const form = $('ingredient-form');
  if (!form) return;
  const input = $('ingredient-input');

  const quickAdd = $('quick-add');
  if (quickAdd) {
    quickAdd.innerHTML = QUICK_INGREDIENTS.map(name =>
      '<button type="button" class="quick-chip" data-ingredient="' + escapeHTML(name) + '" aria-pressed="false">' +
      escapeHTML(name) + '</button>').join('');
    quickAdd.addEventListener('click', event => {
      const button = event.target.closest('.quick-chip');
      if (!button) return;
      const key = normalizeKey(button.dataset.ingredient);
      if (ui.finder.some(item => item.key === key)) {
        removeFinderIngredient(key);
      } else {
        addFinderIngredients(button.dataset.ingredient);
      }
    });
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    addFinderIngredients(input ? input.value : '');
    if (input) {
      input.value = '';
      input.focus();
    }
  });

  const chips = $('selected-ingredients');
  if (chips) {
    chips.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-ingredient]');
      if (button) removeFinderIngredient(button.dataset.removeIngredient);
    });
  }

  const clear = $('clear-ingredients');
  if (clear) {
    clear.addEventListener('click', () => {
      ui.finder = [];
      setFinderMessage('All ingredients cleared.');
      refreshFinder();
    });
  }

  const find = $('find-recipes');
  if (find) {
    find.addEventListener('click', () => {
      if (ui.finder.length === 0) {
        setFinderMessage('Add at least one ingredient to find recipes.');
        return;
      }
      setFinderMessage('');
      ui.finderActive = true;
      renderFinderResults();
      const results = $('finder-results-section');
      if (results && results.scrollIntoView) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const strict = $('strict-match');
  if (strict) {
    strict.addEventListener('change', () => {
      if (ui.finderActive) renderFinderResults();
    });
  }

  const again = $('start-again');
  if (again) {
    again.addEventListener('click', () => {
      ui.finder = [];
      if (strict) strict.checked = false;
      if (input) input.value = '';
      hideFinderResults();
      setFinderMessage('Fresh start! Add some ingredients.');
      renderFinderChips();
      if (input) input.focus();
    });
  }

  renderFinderChips();
}

/* ---------- 12. FAVOURITES AND RECENTLY VIEWED SECTIONS ---------- */

function renderFavourites() {
  const grid = $('favourites-grid');
  if (!grid) return;
  const recipes = store.favourites.map(id => recipeById.get(id)).filter(Boolean);
  renderCards(grid, recipes);
  grid.hidden = recipes.length === 0;
  const empty = $('favourites-empty');
  if (empty) empty.hidden = recipes.length > 0;
}

function addRecentlyViewed(id) {
  store.recent = [id].concat(store.recent.filter(existing => existing !== id)).slice(0, MAX_RECENT);
  writeStorage(STORAGE_KEYS.recent, store.recent);
  renderRecentlyViewed();
}

function renderRecentlyViewed() {
  const grid = $('recent-grid');
  if (!grid) return;
  const recipes = store.recent.map(id => recipeById.get(id)).filter(Boolean);
  renderCards(grid, recipes);
  grid.hidden = recipes.length === 0;
  const empty = $('recent-empty');
  if (empty) empty.hidden = recipes.length > 0;
}

/* ---------- 13. SHOPPING LIST ---------- */

function saveShopping() {
  writeStorage(STORAGE_KEYS.shopping, store.shopping);
}

function addRecipeToShoppingList(recipe, servings) {
  const factor = servings / recipe.servings;
  let added = 0;
  let skipped = 0;
  recipe.ingredients.forEach(item => {
    const key = normalizeKey(item.name) + '|' + item.unit;
    if (store.shopping.some(existing => existing.key === key)) {   // avoid duplicates
      skipped += 1;
      return;
    }
    if (store.shopping.length >= MAX_SHOPPING_ITEMS) return;
    const value = item.qty * factor;
    store.shopping.push({
      key,
      name: displayName(item, value),
      amount: formatAmount(item, value),
      checked: false
    });
    added += 1;
  });
  saveShopping();
  renderShoppingList();
  if (added === 0) {
    showToast('Those ingredients are already on your shopping list');
  } else {
    showToast(added + (added === 1 ? ' item' : ' items') + ' added to your shopping list' +
      (skipped ? ' (' + skipped + ' already there)' : ''));
  }
}

function renderShoppingList() {
  const list = $('shopping-list');
  if (!list) return;
  list.innerHTML = store.shopping.map((item, index) =>
    '<li class="shopping-item' + (item.checked ? ' checked' : '') + '">' +
      '<label><input type="checkbox" class="shopping-check" data-index="' + index + '"' + (item.checked ? ' checked' : '') + '>' +
      '<span class="shopping-text"><span class="shopping-amount">' + escapeHTML(item.amount) + '</span> ' + escapeHTML(item.name) + '</span></label>' +
      '<button type="button" class="icon-btn small" data-remove-shopping="' + index + '" aria-label="Remove ' + escapeHTML(item.name) + ' from the shopping list">×</button>' +
    '</li>').join('');
  list.hidden = store.shopping.length === 0;

  const empty = $('shopping-empty');
  if (empty) empty.hidden = store.shopping.length > 0;
  const purchased = store.shopping.filter(item => item.checked).length;
  const summary = $('shopping-summary');
  if (summary) {
    summary.textContent = store.shopping.length === 0 ? '' : purchased + ' of ' + store.shopping.length + ' items purchased';
  }
  const clearPurchased = $('clear-purchased');
  if (clearPurchased) clearPurchased.disabled = purchased === 0;
  const clearList = $('clear-list');
  if (clearList) clearList.disabled = store.shopping.length === 0;
}

function initShoppingList() {
  const list = $('shopping-list');
  if (!list) return;
  list.addEventListener('change', event => {
    const box = event.target.closest('.shopping-check');
    if (!box) return;
    const item = store.shopping[Number(box.dataset.index)];
    if (!item) return;
    item.checked = box.checked;
    saveShopping();
    renderShoppingList();
  });
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-shopping]');
    if (!button) return;
    store.shopping.splice(Number(button.dataset.removeShopping), 1);
    saveShopping();
    renderShoppingList();
  });
  const clearPurchased = $('clear-purchased');
  if (clearPurchased) {
    clearPurchased.addEventListener('click', () => {
      store.shopping = store.shopping.filter(item => !item.checked);
      saveShopping();
      renderShoppingList();
    });
  }
  const clearList = $('clear-list');
  if (clearList) {
    clearList.addEventListener('click', () => {
      store.shopping = [];
      saveShopping();
      renderShoppingList();
    });
  }
  renderShoppingList();
}

/* ---------- 14. RECIPE MODAL + SERVING CALCULATOR ---------- */

function updateScrollLock() {
  const modal = $('modal-backdrop');
  const cooking = $('cooking-mode');
  const open = (modal && !modal.hidden) || (cooking && !cooking.hidden);
  document.body.classList.toggle('no-scroll', Boolean(open));
}

function renderModalIngredients() {
  const recipe = ui.modalRecipe;
  if (!recipe) return;
  const factor = ui.servings / recipe.servings;
  $('modal-ingredients').innerHTML = recipe.ingredients.map(item => {
    const value = item.qty * factor;
    return '<li><span class="ing-amount">' + escapeHTML(formatAmount(item, value)) + '</span> ' +
      '<span class="ing-name">' + escapeHTML(displayName(item, value)) + '</span></li>';
  }).join('');
  $('servings-value').textContent = String(ui.servings);
  $('servings-minus').disabled = ui.servings <= MIN_SERVINGS;
  $('servings-plus').disabled = ui.servings >= MAX_SERVINGS;
}

function fillModal(recipe) {
  const image = $('modal-image');
  image.src = recipe.image;
  image.alt = recipe.imageAlt;
  $('modal-cuisine').textContent = recipe.cuisine + ' · ' + recipe.category;
  $('modal-title').textContent = recipe.name;
  $('modal-desc').textContent = recipe.description;
  $('modal-meta').innerHTML =
    '<li><span>Prep time</span><strong>' + formatMinutes(recipe.prep) + '</strong></li>' +
    '<li><span>Cook time</span><strong>' + (recipe.cook === 0 ? 'No cooking' : formatMinutes(recipe.cook)) + '</strong></li>' +
    '<li><span>Total</span><strong>' + formatMinutes(recipe.totalTime) + '</strong></li>' +
    '<li><span>Difficulty</span><strong>' + escapeHTML(recipe.difficulty) + '</strong></li>';
  $('modal-tags').innerHTML = recipe.diet.map(tag => '<li class="tag">' + escapeHTML(DIET_LABELS[tag] || tag) + '</li>').join('');
  $('modal-fav').dataset.recipeId = recipe.id;
  const rating = $('modal-rating');
  rating.dataset.recipeId = recipe.id;
  rating.innerHTML = ratingInnerHTML(recipe.id);
  $('modal-steps').innerHTML = recipe.steps.map(step => '<li>' + escapeHTML(step) + '</li>').join('');
  renderModalIngredients();
  updateFavouriteUI();
}

function closeModal() {
  const backdrop = $('modal-backdrop');
  if (!backdrop || backdrop.hidden) return;
  backdrop.hidden = true;
  ui.modalRecipe = null;
  updateScrollLock();
  if (ui.lastFocus && document.contains(ui.lastFocus) && ui.lastFocus.focus) ui.lastFocus.focus();
  ui.lastFocus = null;
}

function changeServings(change) {
  if (!ui.modalRecipe) return;
  ui.servings = clamp(ui.servings + change, MIN_SERVINGS, MAX_SERVINGS);
  renderModalIngredients();
}

function initModal() {
  const backdrop = $('modal-backdrop');
  if (!backdrop || !$('recipe-modal')) return;

  $('modal-close').addEventListener('click', closeModal);
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) closeModal();     // clicks inside the dialog do not close it
  });
  $('servings-minus').addEventListener('click', () => changeServings(-1));
  $('servings-plus').addEventListener('click', () => changeServings(1));
  $('modal-shopping').addEventListener('click', () => {
    if (ui.modalRecipe) addRecipeToShoppingList(ui.modalRecipe, ui.servings);
  });
  $('modal-cook').addEventListener('click', event => {
    if (ui.modalRecipe) startCooking(ui.modalRecipe, event.currentTarget);
  });
  $('modal-print').addEventListener('click', () => window.print());
}

/* ---------- 15. COOKING MODE ---------- */

function startCooking(recipe, opener) {
  const overlay = $('cooking-mode');
  if (!overlay) return;
  ui.cooking = { recipe, index: 0, opener: opener || document.activeElement };
  $('cooking-title').textContent = recipe.name;
  overlay.hidden = false;
  updateScrollLock();
  renderCooking();
  overlay.focus({ preventScroll: true });
}

function renderCooking() {
  const { recipe, index } = ui.cooking;
  if (!recipe) return;
  const total = recipe.steps.length;
  const finished = index >= total;

  $('cooking-step-view').hidden = finished;
  $('cooking-complete').hidden = !finished;
  $('cooking-progress').max = total;
  $('cooking-progress').value = Math.min(index, total);
  $('cooking-prev').disabled = index === 0;
  $('cooking-next').hidden = finished;

  if (finished) {
    $('cooking-prev').textContent = 'Back to last step';
  } else {
    $('cooking-prev').textContent = 'Previous';
    $('cooking-step-label').textContent = 'Step ' + (index + 1) + ' of ' + total;
    $('cooking-instruction').textContent = recipe.steps[index];
    $('cooking-next').textContent = index === total - 1 ? 'Finish' : 'Next';
  }
}

function cookingStep(change) {
  const { recipe, index } = ui.cooking;
  if (!recipe) return;
  ui.cooking.index = clamp(index + change, 0, recipe.steps.length);
  renderCooking();
  if (ui.cooking.index >= recipe.steps.length) $('cooking-exit').focus();
}

function exitCooking() {
  const overlay = $('cooking-mode');
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  updateScrollLock();
  const opener = ui.cooking.opener;
  ui.cooking = { recipe: null, index: 0, opener: null };
  if (opener && document.contains(opener) && opener.focus) opener.focus();
}

function initCookingMode() {
  if (!$('cooking-mode')) return;
  $('cooking-prev').addEventListener('click', () => cookingStep(-1));
  $('cooking-next').addEventListener('click', () => cookingStep(1));
  $('cooking-exit').addEventListener('click', exitCooking);
}

/* ---------- 16. COOKING TIMER ---------- */

const timer = { status: 'idle', remaining: 0, endAt: 0, intervalId: null };

function readTimerInputs() {
  const minutes = clamp(parseInt($('timer-minutes').value, 10) || 0, 0, 99);
  const seconds = clamp(parseInt($('timer-seconds').value, 10) || 0, 0, 59);
  return minutes * 60 + seconds;
}

function formatClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

function renderTimer() {
  if (!$('timer-form')) return;
  const seconds = timer.status === 'idle' ? readTimerInputs() : timer.remaining;
  document.querySelectorAll('[data-timer-display]').forEach(el => {
    el.textContent = formatClock(seconds);
  });
  const running = timer.status === 'running';
  const paused = timer.status === 'paused';
  $('timer-start').disabled = running || paused;
  $('timer-pause').disabled = !running;
  $('timer-resume').disabled = !paused;
  $('timer-reset').disabled = timer.status === 'idle';
  $('timer-minutes').disabled = running || paused;
  $('timer-seconds').disabled = running || paused;
  const chip = $('cooking-timer-chip');
  if (chip) chip.hidden = !(running || paused);
}

function stopTicking() {
  if (timer.intervalId !== null) {
    clearInterval(timer.intervalId);
    timer.intervalId = null;
  }
}

function beginTicking() {
  stopTicking();
  timer.intervalId = setInterval(tickTimer, 250);
}

function tickTimer() {
  timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  if (timer.remaining === 0) {
    finishTimer();
  }
  renderTimer();
}

function finishTimer() {
  stopTicking();
  timer.status = 'done';
  timer.remaining = 0;
  $('timer-message').textContent = 'Time is up! Your timer has finished.';
  showToast('Timer finished!');
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

function startTimer() {
  const total = readTimerInputs();
  if (total <= 0) {
    $('timer-message').textContent = 'Please enter a time greater than zero.';
    return;
  }
  timer.remaining = total;
  timer.endAt = Date.now() + total * 1000;
  timer.status = 'running';
  $('timer-message').textContent = 'Timer running.';
  beginTicking();
  renderTimer();
}

function pauseTimer() {
  if (timer.status !== 'running') return;
  stopTicking();
  timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  timer.status = 'paused';
  $('timer-message').textContent = 'Timer paused.';
  renderTimer();
}

function resumeTimer() {
  if (timer.status !== 'paused') return;
  timer.endAt = Date.now() + timer.remaining * 1000;
  timer.status = 'running';
  $('timer-message').textContent = 'Timer running.';
  beginTicking();
  renderTimer();
}

function resetTimer() {
  stopTicking();
  timer.status = 'idle';
  timer.remaining = 0;
  $('timer-message').textContent = '';
  renderTimer();
}

function initTimer() {
  const form = $('timer-form');
  if (!form) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (timer.status === 'idle' || timer.status === 'done') startTimer();
  });
  $('timer-pause').addEventListener('click', pauseTimer);
  $('timer-resume').addEventListener('click', resumeTimer);
  $('timer-reset').addEventListener('click', resetTimer);
  ['timer-minutes', 'timer-seconds'].forEach(id => {
    $(id).addEventListener('input', () => {
      if (timer.status === 'done') resetTimer();
      else renderTimer();
    });
  });
  window.addEventListener('pagehide', stopTicking);     // clean up when leaving the page
  renderTimer();
}

/* ---------- 17. GLOBAL EVENTS AND START-UP ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter(el => el.getClientRects().length > 0);
}

/** Keeps Tab inside the topmost open dialog. */
function trapFocus(event) {
  const cooking = $('cooking-mode');
  const backdrop = $('modal-backdrop');
  let container = null;
  if (cooking && !cooking.hidden) container = cooking;
  else if (backdrop && !backdrop.hidden) container = $('recipe-modal');
  if (!container) return;

  const items = getFocusable(container);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  } else if (!container.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

function handleDocumentClick(event) {
  const target = event.target;

  const heart = target.closest('.fav-btn');
  if (heart) {
    toggleFavourite(heart.dataset.recipeId);
    return;
  }
  const star = target.closest('.star');
  if (star) {
    const box = star.closest('.rating');
    if (box) setUserRating(box.dataset.recipeId, Number(star.dataset.value));
    return;
  }
  const opener = target.closest('[data-open-recipe]');
  if (opener) {
    openRecipe(opener.dataset.openRecipe, opener);
    return;
  }
  const card = target.closest('.recipe-card');
  if (card && !target.closest('a, button, input, label, select')) {
    openRecipe(card.dataset.recipeId, card.querySelector('.card-open'));
  }
}

function handleDocumentKeydown(event) {
  const cooking = $('cooking-mode');
  const cookingOpen = cooking && !cooking.hidden;

  if (event.key === 'Escape') {
    if (cookingOpen) exitCooking();
    else if ($('modal-backdrop') && !$('modal-backdrop').hidden) closeModal();
    else closeMobileMenu();
    return;
  }
  if (event.key === 'Tab') {
    trapFocus(event);
    return;
  }
  if (cookingOpen && event.key === 'ArrowRight' && ui.cooking.index < ui.cooking.recipe.steps.length) {
    cookingStep(1);
  } else if (cookingOpen && event.key === 'ArrowLeft') {
    cookingStep(-1);
  }
}

function applyImageFallback(img) {
  if (img.dataset.fallback) return;
  img.dataset.fallback = '1';
  img.src = FALLBACK_IMAGE;
}

function initHomePage() {
  const form = $('home-search-form');
  if (form) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const query = $('home-search-input').value.trim().slice(0, 100);
      window.location.href = query ? 'recipe.html?q=' + encodeURIComponent(query) : 'recipe.html';
    });
  }

  const featured = $('featured-grid');
  if (featured) {
    const featuredIds = ['creamy-garden-pasta', 'classic-homemade-pizza', 'masala-dosa', 'chocolate-brownies'];
    renderCards(featured, featuredIds.map(id => recipeById.get(id)).filter(Boolean));
  }
  const quick = $('quick-grid');
  if (quick) {
    const quickRecipes = RECIPES.slice().sort((a, b) => a.totalTime - b.totalTime || a.order - b.order).slice(0, 4);
    renderCards(quick, quickRecipes);
  }
}

function initApp() {
  loadStore();
  initTheme();
  initNavigation();

  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleDocumentKeydown);
  // Image "error" events do not bubble, so listen in the capture phase.
  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement) applyImageFallback(event.target);
  }, true);
  document.querySelectorAll('img').forEach(img => {
    if (img.getAttribute('src') && img.complete && img.naturalWidth === 0) applyImageFallback(img);
  });

  // Each part starts only when its elements exist on the current page.
  initHomePage();
  initModal();
  initCookingMode();
  initIngredientFinder();
  initShoppingList();
  initTimer();
  initExploreControls();
  renderFavourites();
  renderRecentlyViewed();
  updateFavouriteUI();
}

// Apply the saved theme immediately to avoid a flash of the wrong colours.
document.documentElement.setAttribute('data-theme', getInitialTheme());

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
