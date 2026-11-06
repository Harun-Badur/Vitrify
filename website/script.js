(() => {
 const button = document.querySelector(".menu-toggle");
 const nav = document.querySelector(".nav");
 if (button && nav) {
  button.addEventListener("click", () => {
   const expanded = button.getAttribute("aria-expanded") === "true";
   button.setAttribute("aria-expanded", String(!expanded));
   nav.classList.toggle("open", !expanded);
  });
  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
   button.setAttribute("aria-expanded", "false");
   nav.classList.remove("open");
  }));
 }
 document.querySelectorAll("[data-year]").forEach((el) => el.textContent = String(new Date().getFullYear()));
})();