import a from '../../common/a';
const b = require('../../common/b.js');

Page({
  data: a,
  ready() {
    console.log(b)
  }
});