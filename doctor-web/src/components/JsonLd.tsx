/**
 * Renders a schema.org JSON-LD block.
 *
 * `<` is escaped to its < form because JSON-LD lives inside a raw <script> element:
 * a literal `</script>` sequence anywhere in the data would close the tag early.
 * The data here is static, but the escape is what makes that stay safe if it ever
 * is not.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
