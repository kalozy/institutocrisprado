/** Páginas do site. Para criar um curso novo: copie uma pasta de curso e adicione aqui. */
export const PRODUCTS = {
  instituto: {
    id: 'instituto', name: 'Instituto Cris Prado', path: '/', kind: 'site',
    defaults: {}
  },
  'start-lips': {
    id: 'start-lips', name: 'Start Lips', path: '/start-lips/', kind: 'course', category: 'Curso online',
    defaults: { price: '147', promo_text: '' }
  },
  'transforme-faces-com-fios': {
    id: 'transforme-faces-com-fios', name: 'Transforme Faces com Fios', path: '/transforme-faces-com-fios/', kind: 'course', category: 'Formação',
    defaults: { price: '', promo_text: 'Black Friday: condição especial por tempo limitado' }
  }
};

export const COURSES = Object.values(PRODUCTS).filter((p) => p.kind === 'course');

export function getProduct(id) {
  return Object.prototype.hasOwnProperty.call(PRODUCTS, id) ? PRODUCTS[id] : null;
}
