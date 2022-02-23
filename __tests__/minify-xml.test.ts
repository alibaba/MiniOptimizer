import minify_xml, { minify_attr  } from '../src/minify-xml';

test('minify_attr', () => {
  expect(minify_attr('{{ a }}')).toBe('{{a}}');
  expect(minify_attr('{{  {a: 123} }}')).toBe('{{ {a:123} }}');
  expect(minify_attr('{{ undefined }}')).toBe('{{undefined}}');
  expect(minify_attr('{{ a ? b : c }}')).toBe('{{a?b:c}}');
  expect(minify_attr('{{ false && a }}')).toBe('{{false}}');
  expect(minify_attr('{{ 1 + 1 }}')).toBe('{{2}}');
  expect(minify_attr('{{ Infinity }}')).toBe('{{1/0}}');
  expect(minify_attr("{{ 'a': 123 }}", 'data')).toBe('{{a:123}}');
  expect(minify_attr("{{ ...a, ...b, }}", 'data')).toBe('{{...a,...b}}');
  expect(minify_attr("{{ a['name'] }}")).toBe('{{a.name}}');
  expect(minify_attr("{{ a['data-type'] }}")).toBe("{{a['data-type']}}");
  expect(minify_attr("class-1 {{ a['name'] }}  class-2", 'class')).toBe('class-1 {{a.name}} class-2');
  expect(minify_attr("class-1  class-2 ", 'class')).toBe('class-1 class-2');
  expect(minify_attr("class-1  class-2  {{ a }} ", 'class')).toBe('class-1 class-2 {{a}}');
  expect(minify_attr("color: red;", 'style')).toBe('color:red');
  expect(minify_attr("color: red;;", 'style')).toBe('color:red');
  expect(minify_attr("color: {{ red }};{{ fontSize }}", 'style')).toBe('color:{{red}};{{fontSize}}');
  expect(minify_attr("color: {{ red }} ; {{ fontSize }};", 'style')).toBe('color:{{red}};{{fontSize}}');
  expect(minify_attr("color: red;;font-size: 10rpx;", 'style')).toBe('color:red;font-size:10rpx');
  expect(minify_attr("color: red;;font-size: 10rpx {{ top }};", 'style')).toBe('color:red;font-size:10rpx {{top}}');
  expect(minify_attr("color: red;;font-size: 10rpx {{ top }} {{left}};", 'style')).toBe('color:red;font-size:10rpx {{top}} {{left}}');
});

test('minify_xml', () => {
  expect(minify_xml('<tag a="123"></tag>')).toBe(`<tag a="123"/>`);
  expect(minify_xml('<view><text>123  123</text> 123</view>')).toBe(`<view><text>123 123</text> 123</view>`);
  expect(minify_xml(`<view><text>123 {{'  '}} 123</text> 123</view>`)).toBe(`<view><text>123 {{'  '}} 123</text> 123</view>`);
  expect(minify_xml(`<view>
    <text>123</text>
    <text>234</text>
  </view>`)).toBe(`<view><text>123</text><text>234</text></view>`);
  expect(minify_xml('<view><text>123</text> 123</view>')).toBe(`<view><text>123</text> 123</view>`);
  expect(minify_xml('<view> <text>123</text> 123</view>')).toBe(`<view><text>123</text> 123</view>`);
  expect(minify_xml('<block wx:if="{{var_1}}"><tag a="123"/></block>')).toBe(`<tag a="123"wx:if="{{var_1}}"/>`);
  expect(minify_xml('<block wx:for="{{var_1}}"><tag a="123"/></block>')).toBe(`<tag a="123"wx:for="{{var_1}}"/>`);
  expect(minify_xml('<block wx:for="{{ var_1 }}"><tag a="123"/></block>')).toBe(`<tag a="123"wx:for="{{var_1}}"/>`);
  expect(minify_xml('<block><tag a="123"></tag></block>')).toBe(`<tag a="123"/>`);
  expect(minify_xml(`
  <block wx:for="{{var_1}}">
    <block wx:if="{{var_2}}">
      <tag/>
    </block>
  </block>`)).toBe(`<tag wx:if="{{var_2}}"wx:for="{{var_1}}"/>`);
  expect(minify_xml(`
    <block wx:if="{{var_2}}">
      <tag wx:for="{{var_1}}"/>
    </block>`)).toBe(`<tag wx:for="{{var_1}}"wx:if="{{var_2}}"/>`);
  expect(minify_xml(`
  <block wx:if="{{var_2}}">
    <tag wx:for="{{var_1}}"/>
  </block>
  <view wx:else>123</view>`)).toBe(`<block wx:if="{{var_2}}"><tag wx:for="{{var_1}}"/></block><view wx:else>123</view>`);
  expect(minify_xml(`
  <block wx:if="{{var_2}}">
    <tag wx:for="{{var_1}}"/>
  </block>
  <view>123</view>`)).toBe(`<tag wx:for="{{var_1}}"wx:if="{{var_2}}"/><view>123</view>`);

  expect(minify_xml(`
  <view wx:if="{{var_1}}"/>
  <block wx:else>
    <view wx:for="{{var_2}}"/>
  </block>
  `)).toBe(`<view wx:if="{{var_1}}"/><block wx:else><view wx:for="{{var_2}}"/></block>`);
  expect(minify_xml('<view wx:if="{{var_1}}"/><block wx:else><view wx:if="{{var_2}}"/></block>')).toBe(`<view wx:if="{{var_1}}"/><block wx:else><view wx:if="{{var_2}}"/></block>`);
});