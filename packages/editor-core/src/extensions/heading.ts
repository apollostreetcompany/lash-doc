import Heading from '@tiptap/extension-heading';

export const LashHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      headingId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-heading-id'),
        renderHTML: (attributes: { headingId?: string | null }) => {
          if (!attributes.headingId) {
            return {};
          }
          return {
            'data-heading-id': attributes.headingId,
          };
        },
      },
    };
  },
});
