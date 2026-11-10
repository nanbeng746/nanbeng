beng 网页音游 · 代码包
========================

【本包含有的文件】
index.html            主页面（全部界面、打歌、抽卡、商店、合成、乐器合奏都在里面）
charts.js             谱面数据
social.js             登录/好友/圈子/聊天
social-status.js      在线状态
coop.js               协力联机
supabase-config.js    后端配置（Supabase 项目地址+公钥，不用改）
vendor/supabase.js    Supabase 客户端库
ck_*.jpg              11 张角色立绘
README.txt            本说明

【还需要你自己补的文件】
一、背景图 11 张（缺了页面能跑，但背景是暗的）：
   lobby_bg.jpg  game_bg.jpg  shop_bg.jpg  storage_bg.jpg  circle_bg.jpg
   gacha_bg.jpg  bgjq.jpg  bjbq.jpg  jqstl.jpg  wcstl.jpg  wdbq.jpg

二、歌曲音频：
   01.mp3 ~ 13.mp3        MyGO 高清版
   15.mp3 ~ 20.mp3        孤独摇滚高清版
   001.mp3 ~ 013.mp3      压缩版（设置里音质选“低”时用）
   015.mp3 ~ 020.mp3      孤独摇滚压缩版（没传的话低音质会自动回退高清）

【上传顺序】
把这些文件全部传到仓库根目录（vendor/ 整个文件夹一起传），
开启 GitHub Pages（分支 main，目录 / 根目录），等 1-2 分钟即可。

【后端说明】
服务器是 Supabase 项目 trnkjjpijiuaorhossim，代码里已写死配置，
换 GitHub 账号 / 换域名都不用改代码，玩家账号和数据都在原处。
