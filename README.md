# Optimizer

小程序包大小优化工具

__基本能力__

移动(拷贝)子包依赖到子包目录中

> 对于多子包依赖的相同文件，一般会放在主包中，导致主包会包含并不依赖的文件，包体积变大

# 如何使用

```shell
npm install mini-optimizer -D
```

# 命令行

```shell
Usage: optimize <path> [options]

Options:
  -t, --type <type>                     type of mini app wx or my (default: "wx")
  -c, --config <path>                   path to config file (default: "./optimizer.config.json")
  -o, --output <path to fold>           redirect output to the fold
  --remove-useless-file                 remove useless file
  --minify-css                          minify css
  --minify-js                           minify js
  --minify-xs                           minify xs (.sjs|.wxs)
  --minify-xml                          minify xml
  --minify-json                         minify json
  --rename-file                         rename file
  --renamed-files-map <file path>       write renamed file map to the file (default: "./renamed-files-map.json")
  --rename-component                    rename component
  --renamed-components-map <file path>  write renamed component map to the file (default: "./renamed-components-map.json")
  -h, --help                            display help for command
```

# 配置

```json
{
  "renameFile": true,
  "renameComponent": true,
  "minifyJs": true,
  "minifyCss": true,
  "minifyXs": true,
  "minifyXml": true,
  "minifyJson": true,
  "removeUselessFile": true,
  "uselessExculde": [
    "assets/**/*.*"
  ],
  "renameExculde": [
    "assets/images/dish-default.png"
  ],
  "plugins": ["mini-optimizer/lib/plugins/merge-import"],
  "output": "./source-d"
}
```

## renameFile
重命名文件，即：把目录结构打平并且缩短文件名的长度 

文件路径会被包含在JS中，引用的文件路径越长包体积越大

## renameComponent
重命名组件， 即：把组件名称替换为更短的名称

为了XML语义化，在开发时会使用语义化的标签名，比如`user-info`, 这样会增加xml的大小，使用更短的组件名降低包体积。

## minifyJs
压缩JS体积

## minifyXs
压缩`.wxs` 或 `.sjs`体积

## minifyCss
压缩CSS体积

## minifyXml
压缩XML体积

## minifyJSON
压缩JSON体积

## removeUselessFile
移除无用文件

## uselessExculde
保留的文件 支持`glob`

## renameExculde
不重命名的文件 支持`glob`

## output
输出的文件夹

# 插件

## merge-import 

JS文件依赖越多包体积越大，所有通过合并import可以有效减小包体积

```diff
- import Event from '../../common/base/event';
- import System from '../../common/utils/system';
- import { getId } from '../../lib/bizdata';
+ import { b_ as Event, c5 as System, R as getId } from "./__entry__";
```


