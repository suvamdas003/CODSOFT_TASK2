/**
 * Synthetic demo menu used by the seed script and the placeholder image
 * generator. Prices are in MINOR units of the seeded currency (INR paise).
 */
export type SeedItem = {
  name: string;
  description: string;
  price: number;
  dietary?: ("VEGETARIAN" | "VEGAN" | "GLUTEN_FREE" | "DAIRY_FREE" | "NUT_FREE" | "SPICY" | "HALAL")[];
  featured?: boolean;
  available?: boolean;
  prep?: number;
  variants?: { name: string; delta: number }[];
  addOns?: { name: string; price: number }[];
};

export type SeedCategory = { name: string; description: string; color: [string, string]; items: SeedItem[] };

export const SEED_MENU: SeedCategory[] = [
  {
    name: "Starters",
    description: "Small plates to share while you settle in.",
    color: ["#f59e0b", "#b45309"],
    items: [
      {
        name: "Paneer Tikka",
        description: "Charred cottage cheese marinated in yoghurt, kashmiri chilli and ajwain, with mint chutney.",
        price: 32000,
        dietary: ["VEGETARIAN", "GLUTEN_FREE"],
        featured: true,
        prep: 15,
        addOns: [{ name: "Extra mint chutney", price: 3000 }],
      },
      {
        name: "Crispy Corn Pepper Salt",
        description: "Golden fried sweet corn tossed with garlic, spring onion and cracked pepper.",
        price: 24000,
        dietary: ["VEGAN", "SPICY"],
        prep: 10,
      },
      {
        name: "Chicken 65",
        description: "Fiery South Indian fried chicken with curry leaves and green chilli.",
        price: 34000,
        dietary: ["SPICY", "HALAL"],
        prep: 15,
      },
      {
        name: "Tomato Basil Soup",
        description: "Slow-roasted tomatoes, fresh basil and a swirl of cream. Served with garlic toast.",
        price: 18000,
        dietary: ["VEGETARIAN"],
        prep: 8,
        variants: [
          { name: "Cup", delta: 0 },
          { name: "Bowl", delta: 6000 },
        ],
      },
    ],
  },
  {
    name: "Mains",
    description: "Hearty plates cooked to order.",
    color: ["#ef4444", "#991b1b"],
    items: [
      {
        name: "Butter Chicken",
        description: "Tandoor-roasted chicken in a silky tomato, butter and fenugreek gravy.",
        price: 42000,
        dietary: ["HALAL", "GLUTEN_FREE"],
        featured: true,
        prep: 20,
        variants: [
          { name: "Half", delta: 0 },
          { name: "Full", delta: 22000 },
        ],
        addOns: [
          { name: "Extra gravy", price: 6000 },
          { name: "Steamed rice", price: 9000 },
        ],
      },
      {
        name: "Dal Makhani",
        description: "Black lentils simmered overnight with butter and cream.",
        price: 30000,
        dietary: ["VEGETARIAN", "GLUTEN_FREE"],
        prep: 12,
      },
      {
        name: "Thai Green Curry",
        description: "Coconut green curry with seasonal vegetables, Thai basil and jasmine rice.",
        price: 38000,
        dietary: ["VEGAN", "GLUTEN_FREE", "SPICY"],
        prep: 18,
        addOns: [
          { name: "Add tofu", price: 7000 },
          { name: "Add chicken", price: 9000 },
        ],
      },
      {
        name: "Grilled Fish Moilee",
        description: "Kerala-style coconut and turmeric curry with grilled river sole.",
        price: 52000,
        dietary: ["GLUTEN_FREE", "DAIRY_FREE"],
        prep: 22,
      },
      {
        name: "Mushroom Risotto",
        description: "Arborio rice, wild mushrooms, parmesan and truffle oil.",
        price: 44000,
        dietary: ["VEGETARIAN", "GLUTEN_FREE"],
        available: false,
        prep: 20,
      },
    ],
  },
  {
    name: "Breads & Rice",
    description: "Fresh from the tandoor and the handi.",
    color: ["#d97706", "#78350f"],
    items: [
      {
        name: "Garlic Naan",
        description: "Leavened bread with roasted garlic and coriander, brushed with butter.",
        price: 9000,
        dietary: ["VEGETARIAN"],
        prep: 6,
      },
      {
        name: "Tandoori Roti",
        description: "Whole wheat flatbread baked in the clay oven.",
        price: 5000,
        dietary: ["VEGAN"],
        prep: 5,
      },
      {
        name: "Vegetable Biryani",
        description: "Fragrant basmati layered with spiced vegetables, saffron and fried onions. Served with raita.",
        price: 34000,
        dietary: ["VEGETARIAN", "SPICY"],
        prep: 20,
        addOns: [{ name: "Extra raita", price: 4000 }],
      },
    ],
  },
  {
    name: "Pizza & Pasta",
    description: "Stone-baked and hand-tossed.",
    color: ["#16a34a", "#14532d"],
    items: [
      {
        name: "Margherita Pizza",
        description: "San Marzano tomato, fior di latte and fresh basil.",
        price: 36000,
        dietary: ["VEGETARIAN"],
        featured: true,
        prep: 15,
        variants: [
          { name: 'Regular 9"', delta: 0 },
          { name: 'Large 12"', delta: 16000 },
        ],
        addOns: [
          { name: "Extra cheese", price: 6000 },
          { name: "Jalapeños", price: 4000 },
          { name: "Olives", price: 4000 },
        ],
      },
      {
        name: "Penne Arrabbiata",
        description: "Penne in a spicy tomato and garlic sauce with parsley.",
        price: 32000,
        dietary: ["VEGAN", "SPICY"],
        prep: 14,
      },
    ],
  },
  {
    name: "Desserts",
    description: "Something sweet to finish.",
    color: ["#ec4899", "#9d174d"],
    items: [
      {
        name: "Gulab Jamun",
        description: "Warm milk dumplings in cardamom and rose syrup.",
        price: 14000,
        dietary: ["VEGETARIAN"],
        prep: 5,
        addOns: [{ name: "Vanilla ice cream scoop", price: 6000 }],
      },
      {
        name: "Chocolate Lava Cake",
        description: "Molten dark chocolate cake with a scoop of vanilla bean ice cream.",
        price: 22000,
        dietary: ["VEGETARIAN"],
        featured: true,
        prep: 12,
      },
      {
        name: "Mango Sorbet",
        description: "Alphonso mango sorbet — light, bright and dairy-free.",
        price: 16000,
        dietary: ["VEGAN", "GLUTEN_FREE", "NUT_FREE"],
        prep: 3,
      },
    ],
  },
  {
    name: "Beverages",
    description: "Coolers, coffee and chai.",
    color: ["#0ea5e9", "#075985"],
    items: [
      {
        name: "Masala Chai",
        description: "Assam tea brewed with ginger, cardamom and milk.",
        price: 8000,
        dietary: ["VEGETARIAN", "GLUTEN_FREE"],
        prep: 5,
      },
      {
        name: "Fresh Lime Soda",
        description: "Fresh lime with soda — sweet, salted or mixed.",
        price: 9000,
        dietary: ["VEGAN", "GLUTEN_FREE"],
        prep: 3,
        variants: [
          { name: "Sweet", delta: 0 },
          { name: "Salted", delta: 0 },
          { name: "Mixed", delta: 0 },
        ],
      },
      {
        name: "Cold Coffee",
        description: "Blended iced coffee with a hint of vanilla.",
        price: 14000,
        dietary: ["VEGETARIAN"],
        prep: 5,
        addOns: [{ name: "Oat milk", price: 4000 }],
      },
    ],
  },
];
