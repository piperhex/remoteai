/** A valid image reserves space while authenticated file transfers finish. */
export const HTML_IMAGE_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">'
  + '<rect width="320" height="180" rx="8" fill="#edf2ef"/>'
  + '<circle cx="160" cy="90" r="15" fill="none" stroke="#cad9d1" stroke-width="3"/>'
  + '<path d="M160 75a15 15 0 0 1 15 15" fill="none" stroke="#217745" stroke-width="3">'
  + '<animateTransform attributeName="transform" type="rotate" from="0 160 90" to="360 160 90"'
  + ' dur="1s" repeatCount="indefinite"/></path></svg>',
);
