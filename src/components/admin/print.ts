// Prints 1 part of an Admin screen. The print rules in admin-content.css hide
// all of the page except the `.print-root` copy.

export function printElement(element: HTMLElement | null): void {
  if (!element) return;
  document.querySelectorAll(".print-root").forEach((node) => node.remove());
  const root = document.createElement("div");
  root.className = "print-root";
  root.appendChild(element.cloneNode(true));
  document.body.appendChild(root);
  const cleanUp = () => {
    root.remove();
    window.removeEventListener("afterprint", cleanUp);
  };
  window.addEventListener("afterprint", cleanUp);
  window.print();
}
