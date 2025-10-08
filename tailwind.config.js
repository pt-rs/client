/** PT-RS TailwindCSS Config */
module.exports = {
  content: [
    "./views/*.ejs",
    "./views/**/*.ejs",
    "./views/**/**/*.ejs",
  ],
  theme: {
    extend: {},
  },
  plugins: [require("@tailwindcss/forms")],
};
